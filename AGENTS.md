# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# 项目规范

## Git 工作流 —— 不要分叉（重要）

本项目曾因在多台电脑/多个目录各自重建历史并 force-push 导致历史分叉，处理起来很麻烦。
为避免再次发生，严格遵守：

1. **唯一主目录**：本地开发只在 `C:\Users\LTY\Desktop\chatb` 进行。不要再在别处 clone 第二份来改。
2. **唯一分支**：只用 `main`。不开其它分支，不需要 feature 分支（个人自用项目）。
3. **标准流程**：改代码 → `git add .` → `git commit` → `git push`。换设备先 `git pull`。
4. **禁止 force-push**：永远不要 `git push --force` / `git push -f` 覆盖远程历史。
5. **禁止重建历史**：不要在新机器上 `git init` 重新初始化再推送，始终 `git clone` 现有仓库继续。
6. **同步用 pull**：拉取远程改动一律 `git pull`（fast-forward），不要 reset 远程或重写历史。
7. 远程仓库：https://github.com/LTY750/expo-ai-chatbox （分支 main）。

一句话：**一个目录、一个 main 分支、只 pull/push、不 force、不重建历史。**
