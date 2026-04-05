# EasySMS Tampermonkey

主要文件：

- 模板脚本：
  - `C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.user.js`
- 本地覆盖示例：
  - `C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.secrets.example.json`
- 本地生成脚本：
  - `C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\generate_local_userscript.ps1`
- 本地生成结果：
  - `C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.local.user.js`

## 当前脚本定位

这个 userscript 现在是：

- 浏览器内运行的 `EasySMS` runtime

而不是：

- 调本地 `EasySMS` HTTP 服务的桥接器

它会直接在浏览器中访问公开短信站点，抓取手机号列表和短信内容，然后完成：

- 获取公开号码
- 读取短信收件箱
- 提取验证码
- 自动填充手机号 / 验证码
- 保存号码历史
- 在与 `EasyEmail` 并存时自动错开右侧按钮位置

当前模板内置 provider：

- `freephonenum`
- `temp_number`
- `temporary_phone_number`
- `receive_sms_free_cc`
- `yunduanxin`
- `sms24`

## 推荐的本地调试方式

目标：

- 仓库里的模板脚本保持为可提交版本
- 本地仍然可以一键生成一份“带好默认覆盖、可直接导入 Tampermonkey”的 userscript

### 第一步：创建本地覆盖文件

复制：

- `easy_sms_proxy.secrets.example.json`

为：

- `easy_sms_proxy.secrets.local.json`

这个文件名沿用了之前的命名，但这里放的是“本地默认覆盖”，不一定是密钥。

### 第二步：生成本地 userscript

运行：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\generate_local_userscript.ps1"
```

生成结果：

- `C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\easy_sms_proxy.local.user.js`

### 第三步：如果你习惯“直接复制到浏览器”

运行：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Public\nas_home\AI\GameEditor\SMSService\others\tampermonkey\generate_local_userscript.ps1" -CopyToClipboard
```

这样会：

- 生成本地 userscript
- 同时把完整脚本内容直接放进剪贴板

## 本地覆盖字段说明

本地覆盖文件当前支持这些常用字段：

- `providerMode`
- `explicitProviderKey`
- `selectedProvidersCsv`
- `countryName`
- `countryCode`
- `overallLimit`
- `pollSeconds`
- `timeoutSeconds`
- `senderContains`

说明：

- `providerMode` 可选 `auto` 或 `explicit`
- `selectedProvidersCsv` 仅在 `auto` 模式下生效
- `countryName` / `countryCode` 会作为默认筛选条件

## 当前 UI 说明

- 默认只显示右侧三个小按钮：`设 / 号 / 码`
- `设` 用来展开或收起主面板
- `号` 用来直接获取并填手机号
- `码` 用来轮询并填验证码
- 如果同页存在 `EasyEmail` 的迷你栏，当前脚本会自动把自己的按钮栏向左错开
