// 从 Netlify 环境变量读取配置（无需任何第三方依赖）
const CONFIG = {
  APP_ID: process.env.APP_ID,
  APP_SECRET: process.env.APP_SECRET,
  AUTH_KEY: process.env.AUTH_KEY,
  TOKEN_EXPIRE_OFFSET: 60 * 1000 // 提前 60 秒刷新 token
};

// 缓存 access_token
let accessTokenCache = { token: "", expireTime: 0 };

/**
 * 原生 https GET 请求（替代 axios.get）
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`解析响应失败：${err.message}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`请求失败：${err.message}`));
    });
  });
}

/**
 * 原生 https POST 请求（替代 axios.post）
 */
function httpsPost(url, postData) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const data = JSON.stringify(postData);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(url, options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (err) {
          reject(new Error(`解析响应失败：${err.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`请求失败：${err.message}`));
    });

    req.write(data);
    req.end();
  });
}

/**
 * 获取有效 access_token
 */
async function getValidAccessToken() {
  const now = Date.now();
  if (accessTokenCache.token && now < accessTokenCache.expireTime) {
    console.log("使用缓存的 access_token");
    return accessTokenCache.token;
  }

  console.log("重新获取 access_token");
  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${CONFIG.APP_ID}&secret=${CONFIG.APP_SECRET}`;
    const data = await httpsGet(url);
    if (data.errcode) throw new Error(`微信错误：${data.errmsg}（code: ${data.errcode}）`);
    
    accessTokenCache.token = data.access_token;
    accessTokenCache.expireTime = now + (data.expires_in * 1000 - CONFIG.TOKEN_EXPIRE_OFFSET);
    return data.access_token;
  } catch (error) {
    console.error("获取 token 失败：", error.message);
    throw error;
  }
}

/**
 * 发送模板消息核心逻辑
 */
async function sendTemplateMsg(body) {
  const { touser, template_id, page, data } = body;
  
  // 校验参数
  if (!touser || !template_id || !data) {
    return { code: -2, message: "参数缺失：touser、template_id、data 为必填" };
  }

  try {
    const accessToken = await getValidAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`;
    const postData = {
      touser,
      template_id,
      page: page || "",
      data,
      miniprogram_state: "developer" // 测试阶段用 developer
    };

    const wxData = await httpsPost(url, postData);
    if (wxData.errcode === 0) {
      return { code: 0, message: "推送成功", data: { msgid: wxData.msgid } };
    } else {
      return { code: wxData.errcode, message: `推送失败：${wxData.errmsg}` };
    }
  } catch (error) {
    return { code: -3, message: `服务器异常：${error.message}` };
  }
}

/**
 * Netlify Functions 入口 handler
 */
async function handler(event, context) {
  // 跨域响应头（允许小程序调用）
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-auth-key",
    "Content-Type": "application/json"
  };

  // 处理 OPTIONS 预检请求
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: JSON.stringify({ code: 0, message: "预检通过" }) };
  }

  // 处理 GET 请求（健康检查）
  if (event.httpMethod === "GET") {
    if (event.path === "/.netlify/functions/sendTemplateMsg/health") {
      return { statusCode: 200, headers, body: JSON.stringify({ code: 0, message: "代理服务运行正常" }) };
    }
    return { statusCode: 404, headers, body: JSON.stringify({ code: -1, message: "接口不存在" }) };
  }

  // 处理 POST 请求（发送模板消息）
  if (event.httpMethod === "POST" && event.path === "/.netlify/functions/sendTemplateMsg/sendTemplateMsg") {
    try {
      // 1. 鉴权
      const requestAuthKey = event.headers["x-auth-key"];
      if (requestAuthKey !== CONFIG.AUTH_KEY) {
        return { statusCode: 403, headers, body: JSON.stringify({ code: -4, message: "鉴权失败：x-auth-key 不匹配" }) };
      }

      // 2. 解析请求体
      const requestBody = event.body ? JSON.parse(event.body) : {};

      // 3. 调用核心逻辑
      const result = await sendTemplateMsg(requestBody);
      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (error) {
      console.error("接口异常：", error.message);
      return { statusCode: 500, headers, body: JSON.stringify({ code: -5, message: `解析错误：${error.message}` }) };
    }
  }

  // 其他请求返回 404
  return { statusCode: 404, headers, body: JSON.stringify({ code: -6, message: "请求方法或路径错误" }) };
}

// 显式导出 handler
export { handler };
