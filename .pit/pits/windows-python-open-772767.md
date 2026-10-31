---
id: "windows-python-open-772767"
title: "Windows 下 Python open(p,'w') 改写仓库文件会把整文件转成 CRLF，git diff 变成全文件重写"
status: "active"
severity: "medium"
created: "2026-10-31T19:50:04+08:00"
last_seen: "2026-10-31T19:50:04+08:00"
hits: 0
verifications: 0
probe_kind: "shell"
probe_cmd: "python -c \"import pathlib,sys; bad=[str(p) for p in pathlib.Path('.').rglob('*') if p.suffix in {'.js','.mjs','.json','.md','.css','.html'} and not {'.git','.research','chrome-profile','logs','node_modules'} & set(p.parts) and b'\\r\\n' in p.read_bytes()]; print('CRLF files:', bad); sys.exit(0 if bad else 1)\""
probe_strength: "repro"
probe_expect: "CRLF files: \\["
tags:
  - "windows"
  - "git"
  - "line-endings"
  - "python"
anchors:
  - "tests/glossary.test.js @ 63f957fccca5231a626546ac208c240e84cf1bc48bfbbb24bfdf8b82979415e8"
---
## 现象
改了几行代码，`git diff --stat` 却显示 `tests/glossary.test.js | 865 ++++++++++----------`（增删行数接近文件总行数）；`git diff` 里所有行都被标成删除+新增；文件出现 MIXED 行尾（部分 CRLF 部分 LF）。无任何报错。

## 根因
本项目受控文件在仓库里都是 LF（`git show HEAD:<file>` 统计 crlf=0），但 Windows 版 CPython 的 `open(path, "w")` 默认 newline=None，会把写入的 `\n` 转成 os.linesep（CRLF）。用 python 脚本整文件重写一次，行尾就从 LF 全变成 CRLF，git 因此把每行都当成改动。edit 工具不会触发（保留原行尾），混用 python 脚本与 edit 后还会得到 MIXED 行尾。

## 绕法
1) 优先用 edit/write 工具改文件；必须用 python 写时显式 `open(p, "w", encoding="utf-8", newline="\n")`。2) 已污染的文件一次性修回：读 bytes、`replace(b'\r\n', b'\n')`、`write_bytes`。3) 提交前用 `git diff --stat` 复核：行数异常放大的文件就是被转了行尾。
