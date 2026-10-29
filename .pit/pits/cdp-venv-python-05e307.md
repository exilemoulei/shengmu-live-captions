---
id: "cdp-venv-python-05e307"
title: "跑 CDP 冒烟脚本必须用项目 venv 解释器，系统 python 缺 websockets 报 ModuleNotFoundError"
status: "active"
severity: "medium"
created: "2026-10-29T14:58:43+08:00"
last_seen: "2026-10-29T14:58:43+08:00"
last_verified: "2026-10-29T14:58:43+08:00"
hits: 0
verifications: 1
probe_kind: "manual"
reverify: "1) .research/wlk-venv/Scripts/python.exe -c \"import websockets; print(websockets.__version__)\" 应成功。2) 系统 python -c \"import websockets\" 应报 ModuleNotFoundError——这就是用错解释器的症状。3) 冒烟前四件套齐全：CDP 9223（带 --disable-features=CalculateNativeWinOcclusion）、Load-DevExtension.ps1 -Port 9223 加载未打包扩展、本地静态页 http.server 8781、用 curl -X PUT http://127.0.0.1:9223/json/new?chrome-extension://<id>/subtitle.html 打开扩展页当宿主。"
tags:
  - "smoke"
  - "cdp"
  - "python"
signatures:
  - "No module named 'websockets'"
---
跑 .research/ui-smoke-*.py 这类 CDP 冒烟脚本必须用项目虚拟环境解释器 .research/wlk-venv/Scripts/python.exe；系统 Python 没装 websockets，直接 ModuleNotFoundError。

完整前置：
1. dev browser 用 CDP 9223，启动时加 --disable-features=CalculateNativeWinOcclusion（scripts/Start-DevBrowser.ps1 本身不带）。
2. scripts/Load-DevExtension.ps1 -Port 9223 加载未打包扩展。
3. python -m http.server 8781 --directory .research/v0XX-smoke。
4. curl -X PUT http://127.0.0.1:9223/json/new?chrome-extension://<扩展id>/subtitle.html 开宿主页做 sendMessage / executeScript。

缺任何一环脚本都跑不通。
