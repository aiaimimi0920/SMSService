# EasySMS Deploy Workspace

这个目录承载 EasySMS 的工作区级 Docker / 发布 / smoke 资产。
EasySMS 作为独立运行时容器部署，不与其他业务容器强绑定在同一个 compose 编排里。

## 核心部署契约（文件驱动）

- canonical runtime config：`/etc/easy-sms/config.yaml`
- canonical state dir：`/var/lib/easy-sms`
- 最小容器环境变量：
  - `EASY_SMS_CONFIG_PATH`
  - `EASY_SMS_STATE_DIR`
  - `EASY_SMS_RESET_STORE_ON_BOOT`

运行时 provider 与服务参数都应写入 `config.yaml`，不再以零散环境变量作为主契约。

`config.yaml` 顶层字段：

- `server`
- `strategy`
- `maintenance`
- `persistence`
- `scraping`
- `providers`

`maintenance` 额外包含：

- `activeProbeEnabled`
- `activeProbeIntervalMs`

## 目录内关键文件

- `Dockerfile`：构建 EasySMS 服务镜像
- `docker-compose.yaml`：本地 docker compose 运行
- `config.template.yaml`：默认配置模板
- `docker-entrypoint.sh`：容器启动入口（自动生成默认配置，可按需清空 state）
- `publish-ghcr-easy-sms-service.ps1`：本机 GHCR 发布脚本
- `smoke-easy-sms-docker-api.ps1`：容器 API smoke 脚本
- `config/provider-keys.env.example`：预留 provider 密钥环境变量样例

## 独立运行时约定

- 宿主机访问地址：`http://127.0.0.1:18081`
- 其他 Docker 容器访问地址：`http://host.docker.internal:18081`
- 推荐开启 `server.apiKey`，其他程序统一通过 `Authorization: Bearer <token>` 访问
- 当前默认启用的 public-web providers：
  - `freephonenum`
  - `jiemahao`
  - `onlinesim`
  - `quackr`
  - `receivesms_co`
  - `receive_smss`
  - `temp_number`
  - `temporary_phone_number`
  - `receive_sms_free_cc`
  - `yunduanxin`
  - `sms24`
- 运行时会优先尝试 Node `fetch`，命中站点防护时自动回退到容器内 `curl`
- `onlinesim` 走公开 JSON API，其余默认 provider 以 HTML 抓取为主
- 运行时会自动维护 provider 健康状态，并周期性探测站点是“可抓 / challenge / 空站 / blocked”
- provider 级临时禁用、provider 路由冷却和状态快照可以通过 HTTP 管理接口查看或操作

## 快速启动

```powershell
# 在 SMSService 工作区根目录执行
cd C:\Users\Public\nas_home\AI\GameEditor\SMSService

docker compose -f .\deploy\EasySMS\docker-compose.yaml up -d --build
```

默认端口：`http://127.0.0.1:18081`

容器内配置注意：

- 如果把真实运行配置挂进容器，`server.host` 必须绑定到 `0.0.0.0`
- 如果误写成 `127.0.0.1`，容器虽然会正常启动，但 Docker 端口映射无法从宿主机访问
- 当前仓库只保留 `data/.gitkeep`，不版本化任何运行时 state 快照
- 新部署应从空 `data/` 目录启动，由服务自己生成运行状态

示例请求：

```powershell
$headers = @{
  Authorization = "Bearer <server.apiKey>"
}

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/sms/public-numbers?providerKey=freephonenum&limit=5" `
  -Headers $headers

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/providers/health" `
  -Headers $headers

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/providers/selection-plan?countryName=United%20States" `
  -Headers $headers

Invoke-RestMethod -Method Get `
  -Uri "http://127.0.0.1:18081/providers/probe-history" `
  -Headers $headers

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:18081/providers/probe" `
  -Headers $headers
```

## 本地 smoke

```powershell
pwsh .\deploy\EasySMS\smoke-easy-sms-docker-api.ps1 -Rebuild -ApiKey "<server.apiKey>"
```

## 发布 GHCR（本机）

```powershell
pwsh .\deploy\EasySMS\publish-ghcr-easy-sms-service.ps1 -Owner <github-owner> -Push
```
