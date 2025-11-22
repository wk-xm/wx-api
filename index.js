const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { Pool } = require('pg'); // 导入 Postgres 连接池
const app = express();

// 跨域配置（适配小程序）
app.use(cors({ origin: '*' }));
app.use(express.json());

// 1. 小程序配置（★★★替换为你的★★★）
const WX_APPID = "你的小程序AppID";
const WX_SECRET = "你的小程序AppSecret";

// 2. 连接 Postgres 数据库（读取 Vercel 环境变量，无需硬编码）
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL, // 自动读取 Vercel 环境变量
  ssl: {
    rejectUnauthorized: false // 必须开启 SSL，否则连接失败
  }
});

// 初始化数据表（首次运行自动创建，避免手动建表）
async function initTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        openid VARCHAR(100) UNIQUE NOT NULL,
        nickname VARCHAR(50),
        avatar VARCHAR(255),
        create_time TIMESTAMP DEFAULT NOW(),
        update_time TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("数据表初始化成功");
  } catch (err) {
    console.error("数据表初始化失败：", err.message);
  }
}
// 启动时执行初始化
initTable();

// 接口1：code 换 openid + 保存用户到数据库
app.post('/getOpenid', async (req, res) => {
  try {
    const { code, nickname, avatar } = req.body;
    // 校验参数
    if (!code) {
      return res.json({ code: -1, msg: "code不能为空", wxid: "" });
    }

    // 调用微信官方接口获取 openid
    const wxRes = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session?appid=${WX_APPID}&secret=${WX_SECRET}&js_code=${code}&grant_type=authorization_code`
    );
    const wxData = wxRes.data;

    // 处理微信接口错误
    if (wxData.errcode) {
      return res.json({ code: -1, msg: `微信接口错误：${wxData.errmsg}`, wxid: "" });
    }

    const openid = wxData.openid;

    // 3. 数据库操作：新增/更新用户信息
    // 先查询用户是否存在
    const userRes = await pool.query('SELECT * FROM users WHERE openid = $1', [openid]);
    if (userRes.rows.length === 0) {
      // 新增用户（Postgres 用 $1/$2 占位符）
      await pool.query(
        'INSERT INTO users (openid, nickname, avatar) VALUES ($1, $2, $3)',
        [openid, nickname || "", avatar || ""]
      );
    } else {
      // 更新用户信息
      await pool.query(
        'UPDATE users SET nickname = $1, avatar = $2, update_time = NOW() WHERE openid = $3',
        [nickname || "", avatar || "", openid]
      );
    }

    // 成功返回
    return res.json({ code: 0, msg: "success", wxid: openid });
  } catch (err) {
    console.error("接口错误：", err.message);
    return res.json({ code: -1, msg: `服务器错误：${err.message}`, wxid: "" });
  }
});

// 接口2：查询用户信息（根据 openid）
app.post('/getUserInfo', async (req, res) => {
  try {
    const { openid } = req.body;
    if (!openid) {
      return res.json({ code: -1, msg: "openid不能为空", data: null });
    }

    const userRes = await pool.query('SELECT * FROM users WHERE openid = $1', [openid]);
    if (userRes.rows.length === 0) {
      return res.json({ code: -1, msg: "用户不存在", data: null });
    }

    return res.json({ code: 0, msg: "success", data: userRes.rows[0] });
  } catch (err) {
    return res.json({ code: -1, msg: `查询失败：${err.message}`, data: null });
  }
});

// 启动服务（Vercel 自动分配端口）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`服务器运行在端口：${PORT}`);
});

// 导出 Vercel 所需的 handler
module.exports = app;
