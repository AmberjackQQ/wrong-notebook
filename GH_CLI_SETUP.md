# GitHub CLI 安装完成！使用指南

## ✅ 安装状态

GitHub CLI (gh) 已成功安装：
- **版本**: 2.96.0
- **位置**: C:\Program Files\GitHub CLI\gh.exe
- **SSH 连接**: ✅ 正常工作 (已认证为 AmberjackQQ)

## 🔐 下一步：登录 GitHub CLI

由于 GitHub CLI 需要单独认证，请执行以下命令之一：

### 方法 1：使用 SSH 密钥登录（推荐）
```bash
# 重新启动终端以加载 PATH
# 然后执行：
gh auth login
```

在交互式提示中：
1. 选择 **GitHub.com**
2. 选择 **Login with a SSH key**
3. 选择 **你的 SSH 密钥** (通常是 `/c/Users/Amberjack/.ssh/id_ed25519`)
4. 选择 **Yes** 来上传 SSH 密钥

### 方法 2：使用浏览器登录
```bash
gh auth login
```

在交互式提示中：
1. 选择 **GitHub.com**
2. 选择 **Login with a web browser**
3. 复制显示的一次性代码
4. 在浏览器中打开提供的 URL
5. 输入代码完成授权

## 🚀 登录完成后创建仓库

登录成功后，执行以下命令创建仓库并推送代码：

```bash
# 创建仓库并推送代码（一条命令完成）
gh repo create wrong-notebook --public --source=. --remote=origin --push
```

或者分步执行：

```bash
# 1. 创建仓库
gh repo create wrong-notebook --public

# 2. 更新远程仓库地址
git remote set-url origin git@github.com:AmberjackQQ/wrong-notebook.git

# 3. 推送代码
git push -u origin main
```

## 📝 如果遇到问题

### PATH 问题
如果找不到 `gh` 命令，需要重启终端或手动添加到 PATH：

```bash
# 临时添加到当前会话
export PATH="/c/Program Files/GitHub CLI:${PATH}"
```

### SSH 密钥问题
```bash
# 检查 SSH 密钥
ls -la ~/.ssh/

# 测试 SSH 连接
ssh -T git@github.com
```

### 权限问题
```bash
# 检查 GitHub CLI 状态
gh auth status

# 重新登录
gh auth logout
gh auth login
```

## ✨ 完成后

你的仓库将创建在：
https://github.com/AmberjackQQ/wrong-notebook

包含所有最新的功能和修复！
