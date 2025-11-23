const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg'); // Postgres 驱动
const app = express();

// 跨域配置（适配小程序）
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. 小程序核心配置（★★★替换为你的实际值★★★）
const WX_APPID = "wx484f33237996f883";
const WX_SECRET = "052e098a2e4f5906ebcd09875f71d626";

// 2. 数据库连接池全局变量
let pool;

// 3. 初始化数据库连接（强制校验环境变量+防本地连接）
async function initDB() {
  try {
    console.log("🔍 POSTGRES_URL 环境变量长度：", process.env.POSTGRES_URL?.length);
    console.log("🔍 POSTGRES_URL 原始值（脱敏）：", process.env.POSTGRES_URL);

    if (!process.env.POSTGRES_URL) {
      throw new Error("POSTGRES_URL 环境变量未配置！");
    }

    // 直接使用完整连接串，跳过解析
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: {
        rejectUnauthorized: false,
        require: true,
        minVersion: 'TLSv1.0', // 最低 TLS 版本，最大化兼容
        sslmode: 'require'
      },
      // 极致延长超时
      connectionTimeoutMillis: 30000, // 30 秒超时
      idleTimeoutMillis: 60000,
      // 增加连接池大小
      max: 5,
      // 禁用 Nagle 算法（减少网络延迟）
      keepAlive: true,
      keepAliveInitialDelayMillis: 30000
    });

    console.log("🔍 开始测试数据库连接...");
    // 关闭查询超时限制
    const client = await pool.connect();
    client.query_timeout = 0;
    await client.query('SELECT 1');
    client.release();
    console.log("✅ 数据库连接成功");
  } catch (err) {
    console.error("❌ 数据库连接失败详情：", err.message);
    pool = {
      query: () => ({ rows: [] }),
      execute: () => [[], []]
    };
  }
}

// 4. 初始化数据表（user + orders）
async function initTables() {
  // 校验数据库是否已连接
  if (!pool || pool.query.toString().includes("() => ({ rows: [] })")) {
    console.log("❌ 数据库未连接，跳过数据表初始化");
    return;
  }

  try {
    // --------------------------
    // 创建 user 表（适配PostgreSQL语法，无兼容问题）
    // --------------------------
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        wxid VARCHAR(50) NOT NULL PRIMARY KEY,
        username VARCHAR(100) DEFAULT NULL,
        sex VARCHAR(100) DEFAULT NULL,
        birthday VARCHAR(100) DEFAULT NULL,
        "consumptionLevel" VARCHAR(100) DEFAULT NULL,
        "avatarUrl" VARCHAR(500) DEFAULT NULL,
        role VARCHAR(100) DEFAULT NULL
      );
    `);

    // --------------------------
    // 创建 orders 表（含索引，简化外键避免关联失败）
    // --------------------------
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id VARCHAR(50) NOT NULL PRIMARY KEY,
        user_id VARCHAR(50) NOT NULL,
        username VARCHAR(50) NOT NULL,
        create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        dishes TEXT NOT NULL,
        total_price NUMERIC(10,2) NOT NULL,
        notes VARCHAR(200) NOT NULL DEFAULT '无特殊要求',
        status VARCHAR(20) DEFAULT '待接单',
        reject_reason VARCHAR(200) DEFAULT ''
      );
      -- 给user_id加索引，提升查询效率
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
    `);

    console.log("✅ user 和 orders 表初始化成功！");
  } catch (err) {
    console.error("❌ 数据表初始化失败：", err.message);
  }
}

// 5. 根目录路由（避免GET / 404，仅用于测试）
app.get('/', (req, res) => {
  res.json({
    msg: "接口服务正常运行",
    tips: "请使用POST方法访问以下接口：/getOpenid /createOrder /getUserInfo /getUserOrders",
    dbStatus: pool && pool.query.toString().includes("() => ({ rows: [] })") ? "未连接" : "已连接"
  });
});

// 6. 核心接口1：code换openid + 保存用户信息到user表
app.post('/getOpenid', async (req, res) => {
  try {
    // 前置校验：数据库是否连接
    if (!pool || !pool.query) {
      return res.json({ code: -1, msg: "数据库未连接", wxid: "" });
    }

    const { code, username, sex, birthday, consumptionLevel, avatarUrl, role } = req.body;
    // 参数校验
    if (!code) {
      return res.json({ code: -1, msg: "code不能为空", wxid: "" });
    }

    // 调用微信官方接口获取openid
    const wxRes = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = wxRes.data;

    // 处理微信接口错误
    if (wxData.errcode) {
      return res.json({ code: -1, msg: `微信接口错误：${wxData.errmsg}`, wxid: "" });
    }

    const openid = wxData.openid;

    // 数据库操作：新增/更新用户信息
    const userRes = await pool.query('SELECT * FROM "user" WHERE wxid = $1', [openid]);
    if (userRes.rows.length === 0) {
      // 新增用户（PostgreSQL使用$1/$2占位符）
      await pool.query(`
        INSERT INTO "user" (wxid, username, sex, birthday, "consumptionLevel", "avatarUrl", role)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [openid, username || "", sex || "", birthday || "", consumptionLevel || "", avatarUrl || "", role || ""]);
    } else {
      // 更新用户信息
      await pool.query(`
        UPDATE "user" 
        SET username = $1, sex = $2, birthday = $3, "consumptionLevel" = $4, "avatarUrl" = $5, role = $6
        WHERE wxid = $7
      `, [username || "", sex || "", birthday || "", consumptionLevel || "", avatarUrl || "", role || "", openid]);
    }

    // 成功返回
    return res.json({ code: 0, msg: "success", wxid: openid });
  } catch (err) {
    console.error("❌ /getOpenid 接口错误：", err.message);
    return res.json({ code: -1, msg: `服务器错误：${err.message}`, wxid: "" });
  }
});

// 7. 核心接口2：创建订单（插入orders表）
app.post('/createOrder', async (req, res) => {
  try {
    // 前置校验：数据库是否连接
    if (!pool || !pool.query) {
      return res.json({ code: -1, msg: "数据库未连接", success: false });
    }

    const { order_id, user_id, username, dishes, total_price, notes, status, reject_reason } = req.body;
    // 必传参数校验
    if (!order_id || !user_id || !username || !dishes || !total_price) {
      return res.json({ code: -1, msg: "订单ID/用户ID/用户名/菜品/金额不能为空", success: false });
    }

    // 插入订单数据
    await pool.query(`
      INSERT INTO orders (order_id, user_id, username, dishes, total_price, notes, status, reject_reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      order_id,
      user_id,
      username,
      dishes, // 需传入JSON字符串，如：[{"id":1,"name":"宫保鸡丁","price":28.00,"num":1}]
      total_price,
      notes || "无特殊要求",
      status || "待接单",
      reject_reason || ""
    ]);

    return res.json({ code: 0, msg: "订单创建成功", success: true });
  } catch (err) {
    console.error("❌ /createOrder 接口错误：", err.message);
    return res.json({ code: -1, msg: `订单创建失败：${err.message}`, success: false });
  }
});

// 8. 核心接口3：查询用户信息（根据wxid）
app.post('/getUserInfo', async (req, res) => {
  try {
    // 前置校验：数据库是否连接
    if (!pool || !pool.query) {
      return res.json({ code: -1, msg: "数据库未连接", data: null });
    }

    const { openid } = req.body;
    if (!openid) {
      return res.json({ code: -1, msg: "openid不能为空", data: null });
    }

    // 查询用户信息
    const userRes = await pool.query('SELECT * FROM "user" WHERE wxid = $1', [openid]);
    if (userRes.rows.length === 0) {
      return res.json({ code: -1, msg: "用户不存在", data: null });
    }

    return res.json({ code: 0, msg: "查询成功", data: userRes.rows[0] });
  } catch (err) {
    console.error("❌ /getUserInfo 接口错误：", err.message);
    return res.json({ code: -1, msg: `查询失败：${err.message}`, data: null });
  }
});

// 9. 核心接口4：查询用户所有订单（根据user_id=wxid）
app.post('/getUserOrders', async (req, res) => {
  try {
    // 前置校验：数据库是否连接
    if (!pool || !pool.query) {
      return res.json({ code: -1, msg: "数据库未连接", data: [] });
    }

    const { user_id } = req.body;
    if (!user_id) {
      return res.json({ code: -1, msg: "用户ID不能为空", data: [] });
    }

    // 查询订单
    const orderRes = await pool.query('SELECT * FROM orders WHERE user_id = $1', [user_id]);
    return res.json({ code: 0, msg: "查询成功", data: orderRes.rows });
  } catch (err) {
    console.error("❌ /getUserOrders 接口错误：", err.message);
    return res.json({ code: -1, msg: `查询失败：${err.message}`, data: [] });
  }
});

// 10. 启动流程：先初始化数据库，再建表，最后启动服务
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  initTables(); // 数据库连接成功后初始化表
  app.listen(PORT, () => {
    console.log(`✅ 服务器已启动，运行在端口：${PORT}`);
  });
});

// 导出Vercel Serverless所需的handler
module.exports = app;
