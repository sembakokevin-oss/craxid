#!/bin/sh

# Ensure execution of entrypoint.sh
if [ -f /entrypoint.sh ]; then
    exec /entrypoint.sh
elif [ -f ./entrypoint.sh ]; then
    chmod +x ./entrypoint.sh 2>/dev/null
    exec ./entrypoint.sh
else
    echo "Entrypoint script not found!"
    exit 1
fi
