// 1. 引入核心依赖（添加 express 适配 Vercel 服务）
const mysql = require('mysql2/promise');
const express = require('express');
const app = express();

// 2. 全局连接池变量
let pool;

// 3. 数据库连接测试函数
async function testDBConnection() {
  console.log("===== 开始测试数据库连接 =====");

  // 步骤1：检查环境变量
  console.log("🔍 步骤1：检查 MYSQL_URL 环境变量");
  if (!process.env.MYSQL_URL) {
    console.error("❌ 失败：MYSQL_URL 环境变量未配置！");
    return false;
  }
  console.log("✅ 成功：MYSQL_URL 环境变量已配置");
  console.log("🔍 MYSQL_URL 脱敏值：", process.env.MYSQL_URL.replace(/:.+@/, ':****@'));

  // 步骤2：解析+连接数据库
  try {
    const url = new URL(process.env.MYSQL_URL);
    const dbConfig = {
      host: url.hostname,
      port: url.port || 4000,
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      ssl: { rejectUnauthorized: false },
      connectTimeout: 15000,
      connectionLimit: 1
    };
    console.log("\n✅ 步骤2：连接串解析完成");
    console.log("🔍 解析后的配置：", {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database
    });

    // 创建连接池+测试
    console.log("\n🔍 步骤3：尝试连接数据库");
    pool = mysql.createPool(dbConfig);
    const [rows] = await pool.query('SELECT 1 AS test_result');
    
    console.log("✅ 成功：数据库连接正常！");
    console.log("🔍 测试结果：", rows);

    // 关闭连接池（测试用）
    await pool.end();
    console.log("\n✅ 步骤4：连接池已关闭");
    console.log("===== 连接测试完成 =====");
    return true;

  } catch (err) {
    console.error("\n❌ 失败：数据库连接错误 →", err.message);
    console.error("❌ 错误详情：", err.stack.slice(0, 200));
    return false;
  }
}

// 4. 核心：添加 API 接口（Vercel 需导出 HTTP 服务）
// 接口1：测试数据库连接（可通过浏览器/Postman访问）
app.get('/test-db', async (req, res) => {
  const isConnected = await testDBConnection();
  if (isConnected) {
    res.json({ code: 0, msg: "数据库连接成功！" });
  } else {
    res.json({ code: -1, msg: "数据库连接失败！" });
  }
});

// 接口2：默认根路径（访问根域名时返回提示）
app.get('/', (req, res) => {
  res.json({ code: 0, msg: "服务运行正常！访问 /test-db 测试数据库连接" });
});

// 5. 关键：导出 Vercel 所需的 HTTP 服务
// Vercel Serverless 要求导出 app 或 handler
module.exports = app;

// 本地运行时启动服务（Vercel 会自动忽略这部分）
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`本地服务运行在 http://localhost:${PORT}`);
  });
}
