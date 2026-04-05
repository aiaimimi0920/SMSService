# SMSService Browser Helpers

这个目录用于承载与 `SMSService` / `EasySMS` 强相关，但不应进入 canonical repo 的浏览器侧 userscript / bookmarklet / runtime 辅助项目。

当前建议用途：

- provider 登录态保持
- 人工辅助接码调试
- 浏览器侧 API 代理实验
- 本地 userscript 打包产物

约束：

- 正式产品代码应继续放在 `repos/EasySMS`
- 部署脚本与运行模板应继续放在 `deploy/EasySMS`
- 一次性临时脚本应优先放到 `tmp/`
