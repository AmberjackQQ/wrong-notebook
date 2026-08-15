# GitHub 仓库创建和推送命令

## 第一步：在 GitHub 上创建仓库

1. 访问：https://github.com/new
2. 仓库名称：`wrong-notebook`
3. 选择 **Public**
4. ⚠️ **不要** 勾选任何初始化选项
5. 点击 "Create repository"

## 第二步：执行推送命令

创建完成后，按顺序执行以下命令：

```bash
# 1. 更新远程仓库地址为你的 GitHub 账号（使用 SSH）
git remote set-url origin git@github.com:AmberjackQQ/wrong-notebook.git

# 2. 验证远程仓库地址
git remote -v

# 3. 推送代码到 GitHub（首次推送设置上游分支）
git push -u origin main
```

## 如果遇到问题

### 权限错误
```bash
# 确保 SSH 密钥已添加到 GitHub
# 检查 SSH 连接
ssh -T git@github.com
```

### 分支名称错误
```bash
# 如果主分支名称不是 main，检查当前分支
git branch

# 如果需要，推送当前分支
git push -u origin HEAD
```

## 推送成功后

你的代码将在：
https://github.com/AmberjackQQ/wrong-notebook

包含的功能：
- ✅ NextAuth 认证系统修复
- ✅ Docker 容器化部署
- ✅ 多语言支持
- ✅ AI 分析设置选项
- ✅ 备案信息显示
- ✅ 数据库同步修复
