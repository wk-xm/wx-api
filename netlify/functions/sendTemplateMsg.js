const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// 1. 跨域配置（允许小程序调用）
app.use(cors({
  origin: "*", // 上线可改为你的小程序域名（如 https://servicewechat.com），更安全
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "x-auth-key"]
}));

// 2. 解析 JSON 请求体（小程序 post 请求需用）
app.use(express.json({ limit: "1mb" }));

// 3. 从 Netlify 环境变量读取配置（敏感信息不硬编码）
const CONFIG = {
  APP_ID: process.env.APP_ID, // 小程序 AppID（Netlify 后台配置）
  APP_SECRET: process.env.APP_SECRET, // 小程序 AppSecret（Netlify 后台配置）
  AUTH_KEY: process.env.AUTH_KEY, // 自定义鉴权密钥（Netlify 后台配置）
  TOKEN_EXPIRE_OFFSET: 60 * 1000 // access_token 提前 60 秒刷新
};

// 4. 缓存 access_token（避免频繁调用微信接口）
let accessTokenCache = {
  token: "",
  expireTime: 0 // 过期时间戳（毫秒）
};

/**
 * 内部方法：获取有效 access_token
 */
async function getValidAccessToken() {
  const now = Date.now();
  // 缓存有效则直接返回
  if (accessTokenCache.token && now < accessTokenCache.expireTime) {
    console.log("使用缓存的 access_token");
    return accessTokenCache.token;
  }
  // 缓存过期，重新请求微信接口
  console.log("重新获取 access_token");
  try {
    const response = await axios.get(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${CONFIG.APP_ID}&secret=${CONFIG.APP_SECRET}`
    );
    const data = response.data;
    if (data.errcode) {
      throw new Error(`微信接口错误：${data.errmsg}（code: ${data.errcode}）`);
    }
    // 更新缓存（有效期 = 微信返回的 expires_in - 提前刷新时间）
    accessTokenCache.token = data.access_token;
    accessTokenCache.expireTime = now + (data.expires_in * 1000 - CONFIG.TOKEN_EXPIRE_OFFSET);
    return data.access_token;
  } catch (error) {
    console.error("获取 access_token 失败：", error.message);
    throw error;
  }
}

/**
 * 对外接口：发送模板消息（小程序调用此接口）
 * 请求方式：POST
 * 请求地址：https://你的Netlify域名/sendTemplateMsg
 */
app.post('/sendTemplateMsg', async (req, res) => {
  try {
    // 步骤1：鉴权（防止接口被滥用）
    const requestAuthKey = req.headers['x-auth-key'];
    if (requestAuthKey !== CONFIG.AUTH_KEY) {
      return res.status(403).json({
        code: -1,
        message: "鉴权失败：非法请求（x-auth-key 不匹配）"
      });
    }

    // 步骤2：校验必填参数
    const { touser, template_id, page, data } = req.body;
    if (!touser || !template_id || !data) {
      return res.status(400).json({
        code: -2,
        message: "参数缺失：touser（用户openid）、template_id（模板ID）、data（模板数据）为必填"
      });
    }

    // 步骤3：获取 access_token
    const accessToken = await getValidAccessToken();

    // 步骤4：转发请求到微信模板消息接口
    const wxResponse = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
      {
        touser: touser, // 接收者 openid
        template_id: template_id, // 模板 ID
        page: page || "", // 点击跳转页面（可选）
        data: data, // 模板字段数据
        miniprogram_state: "formal" // 上线时用 formal，测试用 developer
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    // 步骤5：返回结果给小程序
    const wxData = wxResponse.data;
    if (wxData.errcode === 0) {
      res.json({
        code: 0,
        message: "模板消息推送成功",
        data: { msgid: wxData.msgid }
      });
    } else {
      res.json({
        code: wxData.errcode,
        message: `推送失败：${wxData.errmsg}`,
        data: wxData
      });
    }
  } catch (error) {
    console.error("代理服务异常：", error.message);
    res.status(500).json({
      code: -3,
      message: `服务器异常：${error.message}`
    });
  }
});

// 5. 健康检查接口（可选，用于测试服务是否正常）
app.get('/health', (req, res) => {
  res.json({ code: 0, message: "代理服务运行正常" });
});

// 6. 启动服务（Netlify 自动分配端口，必须用 process.env.PORT）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`代理服务已启动，端口：${PORT}`);
  console.log(`服务地址：http://localhost:${PORT}`);
});

// 导出 app 供 Netlify 识别
module.exports = app;
