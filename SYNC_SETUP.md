# GitHub 私有仓库直连同步

网页由 GitHub Pages 托管，并直接通过 GitHub REST API 将个人学习数据保存到单独的 GitHub 私有仓库。不需要 Cloudflare、独立服务器或网站账户系统。

## 1. 创建私有数据仓库

当前站点使用的私有仓库为 `Cityfishman/IELSnetwork-data`，默认分支是 `main`。网页已经预填这些信息，不需要重复创建仓库。数据文件由首次连接的浏览器上传，不要提前创建空的学习数据文件。

若以后迁移到其他仓库，请创建一个空的私有仓库。建议让网站代码与个人数据使用两个不同仓库，不要把数据仓库配置为 GitHub Pages 源。

仓库需要存在默认分支。若它是全新的空仓库，请先在 GitHub 中勾选创建 README，或手动完成第一次提交。

## 2. 创建最小权限 Token

网页“设置”中的“创建同步 Token”会打开 GitHub，并预填所有者、名称、90 天有效期和 Contents 读写权限。仍需手动选择 **Only select repositories → IELSnetwork-data**，再点击 **Generate token**。URL 预填字段参见 [GitHub 官方说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#pre-filling-fine-grained-personal-access-token-details-using-url-parameters)。

在 GitHub 的 **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 中创建 Token：

- Repository access：只选择上一步的数据仓库。
- Repository permissions：仅将 **Contents** 设置为 **Read and write**。
- 设置合理的过期时间。
- 不需要 Actions、Administration 或 Workflows 权限。

Token 只会显示一次，请妥善保存；不要将它写入仓库文件、Issue 或聊天记录。

## 3. 在网页中连接

打开网站的“设置”，填写：

- 仓库所有者，例如 `Cityfishman`。
- 私有仓库名称，例如 `IELSnetwork-data`。
- 分支，通常为 `main`。
- 数据文件路径，默认 `data/listenfolio-state.json`。
- fine-grained Token。

首次连接时：

- 首先在已有学习记录的设备上连接；其他设备随后使用相同仓库配置和有效 Token 连接。
- 如果数据文件不存在，当前浏览器数据会创建为第一次 Git 提交。
- 如果数据文件已经存在，网页会优先加载仓库版本。
- 后续修改会在约一秒后自动提交。

## Token 保存方式

默认不勾选“信任此设备”：Token 存放在 `sessionStorage`，关闭浏览器会话后需要重新输入。

勾选“信任此设备”：Token 存放在 `localStorage`，以后可以自动同步，但任何能读取该浏览器站点数据的人或恶意脚本都可能获取它。只应在自己的可信设备上使用。

## 冲突与恢复

网页更新数据文件时会携带 GitHub 返回的文件 SHA。如果另一台设备已经更新文件，GitHub 会拒绝旧 SHA；网页随后会让你选择使用本机数据覆盖，或加载最新仓库版本。

每次成功同步都会产生一个 Git 提交，因此可以从私有仓库历史中恢复旧版本。网页仍保留本地缓存和 JSON 导入、导出功能。
