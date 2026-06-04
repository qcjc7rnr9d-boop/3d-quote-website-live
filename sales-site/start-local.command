#!/bin/zsh
cd "$(dirname "$0")" || exit 1
HOST=127.0.0.1 PORT=3000 npm start
