// 1. 导入依赖
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// 2. 全局配置（解决跨域+解析JSON）
app.use(cors({ 
  origin: '*',  // 允许所有域名访问（小程序开发阶段可用，生产可限定小程序域名）
  methods: ['GET', 'POST'],  // 允许的请求方法
  allowedHeaders: ['Content-Type']  // 允许的请求头
}));
app.use(express.json());  // 解析JSON格式的请求体

// 3. 小程序核心配置（★★★替换为你的信息★★★）
const WX_APPID = "wx484f33237996f883";  // 你的小程序AppID
const WX_SECRET = "052e098a2e4f5906ebcd09875f71d626";  // 你的小程序AppSecret

// 4. 核心接口：/getOpenid（接收code，返回openid）
app.post('/getOpenid', async (req, res) => {
  try {
    // 4.1 从请求体获取小程序传过来的code
    const { code } = req.body;
    // 4.2 校验code是否为空
    if (!code) {
      return res.status(200).json({
        code: -1,
        msg: "参数错误：code不能为空",
        wxid: ""
      });
    }
    // 4.3 调用微信官方code2session接口
    const wxRes = await axios.get(
      `https://api.weixin.qq.com/sns/jscode2session`,
      {
        params: {
          appid: WX_APPID,
          secret: WX_SECRET,
          js_code: code,
          grant_type: 'authorization_code'
        }
      }
    );
    // 4.4 解析微信返回结果
    const wxData = wxRes.data;
    // 4.5 处理微信返回的错误（如code无效）
    if (wxData.errcode) {
      return res.status(200).json({
        code: -1,
        msg: `微信接口错误：${wxData.errmsg}`,
        wxid: ""
      });
    }
    // 4.6 成功返回openid（wxid为自定义字段，和你原PHP接口兼容）
    return res.status(200).json({
      code: 0,
      msg: "success",
      wxid: wxData.openid,  // 核心返回openid
      unionid: wxData.unionid || ""  // 可选，有unionid则返回
    });
  } catch (err) {
    // 5. 异常处理（如网络错误、接口超时）
    return res.status(200).json({
      code: -1,
      msg: `服务器错误：${err.message}`,
      wxid: ""
    });
  }
});

// 6. 启动服务（Vercel自动分配端口，无需固定）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`接口服务启动成功，端口：${PORT}`);
});

// 7. 导出Vercel所需的handler（必须，否则Vercel无法识别）
module.exports = app;
