# SMSService Workspace Structure

`SMSService` 采用与 `EmailService` 同风格的工作区结构，用根工作区承载部署与运维资产，把实际产品代码放入 `repos/` 下的独立仓库。

## 顶层分层

- `AIRead/`
  - 共享知识与运维资料入口（junction 到 `C:\Users\Public\nas_home\AI\AIRead`）
- `deploy/`
  - 部署流程脚本、部署配置样例、手工 runbook 的承载层
- `docs/`
  - 工作区自身结构说明
- `repos/`
  - 实际维护的 git 仓库
- `others/`
  - 与主项目强相关、但不适合放入 canonical repo / deploy / tmp 的辅助子项目
- `tmp/`
  - 临时辅助工具、测试脚本、人工值守辅助资源

## 当前 canonical repos

- `repos/EasySMS`

---

## 分层原则

### 什么时候改 `repos/`

只有当某个服务的实际产品代码、仓内正式文档或正式接口实现发生变化时，才修改：

- `repos/EasySMS`

其中：

- `EasySMS` 是本地短信聚合服务的 canonical repo
- 当前先交付可运行的服务骨架与工作区契约
- 当前默认 provider 是：`mock_sms`
- 当前 Docker runtime 契约是文件驱动：
  - config：`/etc/easy-sms/config.yaml`
  - state：`/var/lib/easy-sms`
- 当前根工作区尚未绑定远端 submodule URL，`repos/EasySMS` 先以内嵌独立仓库方式初始化

### 什么时候放 `deploy/`

如果只是：

- 部署流程脚本
- 本机运行脚本
- deploy template
- 不属于主仓正式发布内容的运维脚本

应优先放到：

- `deploy/EasySMS/`

### 什么时候放 `AIRead/部署/SMSService`

如果是：

- 部署说明
- 运维接口认知
- 长期保留的值守知识
- 当前线上环境的操作说明
- provider 接入 / 切换说明

应优先放到：

- `AIRead/部署/SMSService/`

### 什么时候放 `others/`

如果是：

- 与 `SMSService` / `EasySMS` 强相关
- 但不属于 canonical repo 正式产品代码
- 又不只是临时一次性的测试脚本
- 适合单独维护的辅助子项目（例如 Tampermonkey / bookmarklet / 浏览器侧短信接码辅助脚本）

应优先放到：

- `others/tampermonkey/`

### 什么时候放 `tmp/`

如果是：

- 临时人工检查脚本
- 短期值守工具
- 一次性实验产物
- 不需要长期维护的辅助资源

应优先放到：

- `tmp/EasySMS/`
