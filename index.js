const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg'); // Postgres 驱动
const app = express();

// 跨域配置（适配小程序）
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. 小程序配置（★★★替换为你的★★★）
const WX_APPID = "wx484f33237996f883";
const WX_SECRET = "052e098a2e4f5906ebcd09875f71d626";

// 2. 连接 Postgres 数据库（读取 Vercel 环境变量）
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false // 必须开启 SSL
  }
});

// 初始化数据表：首次加载创建 user + orders 表（兼容 Postgres 语法）
async function initTables() {
  try {
    // --------------------------
    // 第一步：创建 user 表（适配 Postgres 语法）
    // --------------------------
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        username VARCHAR(100) DEFAULT NULL COMMENT '用户名',
        wxid VARCHAR(50) NOT NULL COMMENT '用户唯一标识（微信OpenID）',
        sex VARCHAR(100) DEFAULT NULL COMMENT '性别',
        birthday VARCHAR(100) DEFAULT NULL COMMENT '生日',
        "consumptionLevel" VARCHAR(100) DEFAULT NULL COMMENT '消费等级',
        "avatarUrl" VARCHAR(500) DEFAULT NULL COMMENT '头像',
        role VARCHAR(100) DEFAULT NULL COMMENT '身份',
        PRIMARY KEY (wxid)
      );
      COMMENT ON TABLE "user" IS '用户表：存储微信用户基础信息';
    `);

    // --------------------------
    // 第二步：创建 orders 表（适配 Postgres 语法 + 外键关联）
    // --------------------------
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id VARCHAR(50) NOT NULL COMMENT '订单唯一ID（自增主键）',
        user_id VARCHAR(50) NOT NULL COMMENT '下单用户ID（关联user.wxid）',
        username VARCHAR(50) NOT NULL COMMENT '下单用户名',
        create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '订单创建时间',
        dishes TEXT NOT NULL COMMENT '菜品信息（JSON字符串）',
        total_price NUMERIC(10,2) NOT NULL COMMENT '订单总金额（精确到分）',
        notes VARCHAR(200) NOT NULL DEFAULT '无特殊要求' COMMENT '用户订单备注',
        status VARCHAR(20) DEFAULT '待接单' COMMENT '订单状态（待接单/已接单/已拒单/已完成）',
        reject_reason VARCHAR(200) DEFAULT '' COMMENT '拒单理由',
        PRIMARY KEY (order_id),
        CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES "user" (wxid)
      );
      COMMENT ON TABLE orders IS '订单主表：存储所有用户订单，支持权限隔离查询';
      -- 给 user_id 加索引（提升查询效率）
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
    `);

    console.log("✅ user 和 orders 表初始化成功");
  } catch (err) {
    console.error("❌ 数据表初始化失败：", err.message);
    // 若外键关联失败（如 user 表未创建），跳过外键重试（可选）
    if (err.message.includes('foreign key constraint')) {
      console.log("⚠️ 外键关联失败，尝试跳过外键创建 orders 表");
      await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
          order_id VARCHAR(50) NOT NULL COMMENT '订单唯一ID（自增主键）',
          user_id VARCHAR(50) NOT NULL COMMENT '下单用户ID（关联user.wxid）',
          username VARCHAR(50) NOT NULL COMMENT '下单用户名',
          create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '订单创建时间',
          dishes TEXT NOT NULL COMMENT '菜品信息（JSON字符串）',
          total_price NUMERIC(10,2) NOT NULL COMMENT '订单总金额（精确到分）',
          notes VARCHAR(200) NOT NULL DEFAULT '无特殊要求' COMMENT '用户订单备注',
          status VARCHAR(20) DEFAULT '待接单' COMMENT '订单状态',
          reject_reason VARCHAR(200) DEFAULT '' COMMENT '拒单理由',
          PRIMARY KEY (order_id)
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
      `);
      console.log("✅ orders 表（无外键）创建成功");
    }
  }
}

// 服务启动时执行表初始化
initTables();

// 接口1：code 换 openid + 保存用户到 user 表
app.post('/getOpenid', async (req, res) => {
  try {
    const { code, username, sex, birthday, consumptionLevel, avatarUrl, role } = req.body;
    if (!code) {
      return res.json({ code: -1, msg: "code不能为空", wxid: "" });
    }

    // 调用微信接口获取 openid
    const wxRes = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = wxRes.data;
    if (wxData.errcode) {
      return res.json({ code: -1, msg: `微信接口错误：${wxData.errmsg}`, wxid: "" });
    }

    const openid = wxData.openid;

    // 保存/更新用户信息到 user 表
    const userRes = await pool.query('SELECT * FROM "user" WHERE wxid = $1', [openid]);
    if (userRes.rows.length === 0) {
      // 新增用户
      await pool.query(`
        INSERT INTO "user" (wxid, username, sex, birthday, "consumptionLevel", "avatarUrl", role)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [openid, username || "", sex || "", birthday || "", consumptionLevel || "", avatarUrl || "", role || ""]);
    } else {
      // 更新用户
      await pool.query(`
        UPDATE "user" 
        SET username = $1, sex = $2, birthday = $3, "consumptionLevel" = $4, "avatarUrl" = $5, role = $6
        WHERE wxid = $7
      `, [username || "", sex || "", birthday || "", consumptionLevel || "", avatarUrl || "", role || "", openid]);
    }

    return res.json({ code: 0, msg: "success", wxid: openid });
  } catch (err) {
    console.error("getOpenid 接口错误：", err.message);
    return res.json({ code: -1, msg: `服务器错误：${err.message}`, wxid: "" });
  }
});

// 接口2：创建订单（插入 orders 表）
app.post('/createOrder', async (req, res) => {
  try {
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
      dishes, // 需传入 JSON 字符串（如 '[{"id":1,"name":"宫保鸡丁","price":28.00,"num":1}]'）
      total_price,
      notes || "无特殊要求",
      status || "待接单",
      reject_reason || ""
    ]);

    return res.json({ code: 0, msg: "订单创建成功", success: true });
  } catch (err) {
    console.error("createOrder 接口错误：", err.message);
    return res.json({ code: -1, msg: `订单创建失败：${err.message}`, success: false });
  }
});

// 接口3：查询用户订单（根据 user_id）
app.post('/getUserOrders', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.json({ code: -1, msg: "用户ID不能为空", data: [] });
    }

    const orderRes = await pool.query('SELECT * FROM orders WHERE user_id = $1', [user_id]);
    return res.json({ code: 0, msg: "查询成功", data: orderRes.rows });
  } catch (err) {
    console.error("getUserOrders 接口错误：", err.message);
    return res.json({ code: -1, msg: `查询失败：${err.message}`, data: [] });
  }
});

// 启动服务
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口：${PORT}`);
});

// 导出 Vercel 所需 handler
module.exports = app;
