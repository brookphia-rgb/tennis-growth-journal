# 许子越网球成长记录

面向手机使用的训练日志 PWA，覆盖网球训练、体能训练、比赛复盘、拉伸恢复、饮食与休息。支持自然语言快速记录、周报分析、数据导入导出和离线访问。

## 本地运行

项目没有构建依赖，使用任意静态服务器即可：

```bash
python3 -m http.server 4173
```

打开 `http://localhost:4173`。

## 数据说明

当前版本把记录保存在浏览器 `localStorage` 中。可在“历史记录”右上角导出 JSON 备份，也可在设置中导入。不同设备之间暂不会自动同步。

## 部署

整个目录可以直接部署到 GitHub Pages、Cloudflare Pages、Netlify 或 Vercel。无需构建命令，发布目录为项目根目录。

## 后续在线化建议

要实现手机、电脑跨设备同步以及聊天软件录入，建议增加一个轻量后端：

- 数据库与登录：Supabase（PostgreSQL + 邮箱验证码登录）
- 定时周报：Supabase Edge Function 或 GitHub Actions
- 自然语言解析：服务端调用大模型，输出与当前记录结构一致的 JSON
- 聊天入口：企业微信、飞书或 Telegram Bot Webhook

聊天消息和网页表单最终都写入同一套记录表，周报只从数据库读取，避免形成两份数据。
