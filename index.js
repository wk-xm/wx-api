// 1. 替换 pg 驱动为 mysql2
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql2/promise'); // 替换 pg 为 mysql2
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// 小程序配置（不变）
const WX_APPID = "wx484f33237996f883";
const WX_SECRET = "052e098a2e4f5906ebcd09875f71d626";

// 2. 修改数据库连接池（适配 MySQL）
let pool;
async function initDB() {
  try {

    // 新增：打印环境变量原始值（脱敏），确认是否读取到
    console.log("🔍 MYSQL_URL 环境变量是否存在：", !!process.env.MYSQL_URL);
    console.log("🔍 MYSQL_URL 长度：", process.env.MYSQL_URL?.length);
    console.log("🔍 MYSQL_URL 脱敏值：", process.env.MYSQL_URL?.replace(/:.+@/, ':****@'));

    // 从 Vercel 环境变量读取 TiDB MySQL 连接串
    const mysqlUrl = process.env.MYSQL_URL; // 后续配置 MYSQL_URL 环境变量
    if (!mysqlUrl) throw new Error("MYSQL_URL 环境变量未配置！");

    // 解析 MySQL 连接串（格式：mysql://user:password@host:4000/dbname?sslmode=require）
    const url = new URL(mysqlUrl);
    const config = {
      host: url.hostname,
      port: url.port || 4000, // TiDB MySQL 默认端口 4000
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      ssl: { rejectUnauthorized: false }, // 强制 SSL
      connectTimeout: 15000, // 15 秒超时
      waitForConnections: true,
      connectionLimit: 5
    };

    // 创建 MySQL 连接池
    pool = mysql.createPool(config);
    // 测试连接
    const [rows] = await pool.query('SELECT 1');
    console.log("✅ TiDB MySQL 连接成功");
  } catch (err) {
    console.error("❌ 数据库连接失败：", err.message);
    pool = { query: () => [[], []] }; // 兜底
  }
}

// 3. 修改建表语句（MySQL 语法，和原逻辑一致）
async function initTables() {
  if (!pool || pool.query.toString().includes("() => [[], []]")) {
    console.log("❌ 数据库未连接，跳过建表");
    return;
  }
  try {
    // 创建 user 表（MySQL 语法，去掉双引号，兼容驼峰）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user (
        wxid VARCHAR(50) NOT NULL PRIMARY KEY,
        username VARCHAR(100) DEFAULT NULL,
        sex VARCHAR(100) DEFAULT NULL,
        birthday VARCHAR(100) DEFAULT NULL,
        consumptionLevel VARCHAR(100) DEFAULT NULL,
        avatarUrl VARCHAR(500) DEFAULT NULL,
        role VARCHAR(100) DEFAULT NULL
      );
    `);
    // 创建 orders 表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id VARCHAR(50) NOT NULL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        dishes TEXT NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        notes VARCHAR(200) NOT NULL DEFAULT '无特殊要求',
        status VARCHAR(20) DEFAULT '待接单',
        reject_reason VARCHAR(200) DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
    `);
    console.log("✅ 表初始化成功");
  } catch (err) {
    console.error("❌ 建表失败：", err.message);
  }
}

// 4. 修改接口中的数据库操作（MySQL 占位符用 ? 替代 $1）
app.post('/getOpenid', async (req, res) => {
  try {
    if (!pool || pool.query.toString().includes("() => [[], []]")) {
      return res.json({ code: -1, msg: "数据库未连接", wxid: "" });
    }
    const { code, username, sex, birthday, consumptionLevel, avatarUrl, role } = req.body;
    if (!code) return res.json({ code: -1, msg: "code不能为空", wxid: "" });

    // 微信接口逻辑不变
    const wxRes = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = wxRes.data;
    if (wxData.errcode) return res.json({ code: -1, msg: wxData.errmsg, wxid: "" });
    const openid = wxData.openid;

    // MySQL 操作（占位符用 ?）
    const [userRes] = await pool.query('SELECT * FROM user WHERE wxid = ?', [openid]);
    if (userRes.length === 0) {
      await pool.query(`
        INSERT INTO user (wxid, username, sex, birthday, consumptionLevel, avatarUrl, role)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [openid, username || "", sex || "", birthday || "", consumptionLevel || "", avatarUrl || "", role || ""]);
    } else {
      await pool.query(`
        UPDATE user SET username = ?, sex = ?, birthday = ?, consumptionLevel = ?, avatarUrl = ?, role = ? WHERE wxid = ?
      `, [username || "", sex || "", birthday || "", consumptionLevel || "", avatarUrl || "", role || "", openid]);
    }
    return res.json({ code: 0, msg: "success", wxid: openid });
  } catch (err) {
    console.error("❌ /getOpenid 错误：", err.message);
    return res.json({ code: -1, msg: err.message, wxid: "" });
  }
});

// 其他接口（createOrder/getUserInfo/getUserOrders）同理：
// - 占位符从 $1/$2 改为 ?
// - 表名去掉双引号（MySQL 无需转义）
// - 数值类型从 NUMERIC 改为 DECIMAL（MySQL 兼容）

// 根目录路由+启动流程不变
app.get('/', (req, res) => {
  res.json({
    msg: "TiDB MySQL 接口正常",
    dbStatus: pool && pool.query.toString().includes("() => [[], []]") ? "未连接" : "已连接"
  });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  initTables();
  app.listen(PORT, () => console.log(`✅ 服务器启动：${PORT}`));
});

module.exports = app;
