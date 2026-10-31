#!/usr/bin/env fish

set BASEN_ROOT (path resolve (dirname (status --current-filename))/..)
set STUDY $BASEN_ROOT/apps/study
set NOTEBOOK $BASEN_ROOT/apps/notebook
set LOGS /tmp/kratt-logs
mkdir -p $LOGS

# Start Kratt's engine (Open Notebook's database and API, without its web UI). The Study folder
# service sends Kratt Chat's and extensions' AI prompts there (logs in /tmp/kratt-logs)
if curl -s -o /dev/null http://127.0.0.1:5055/health
    echo "Kratt's engine is already running."
else
    echo "Starting Kratt's engine..."
    cd $NOTEBOOK
    for line in (string match -r '^(?:SURREAL_(?:USER|PASSWORD)|KRATT_ENGINE_PASSWORD)=.*' < .env)
        set -l kv (string split -m1 = -- $line)
        set -gx $kv[1] (string trim -c '"\'' -- $kv[2])
    end
    # KRATT_ENGINE_PASSWORD (in .env or the shell) is the engine's password; the API reads it
    # as OPEN_NOTEBOOK_PASSWORD
    if set -q KRATT_ENGINE_PASSWORD
        set -gx OPEN_NOTEBOOK_PASSWORD $KRATT_ENGINE_PASSWORD
    end
    if not curl -s -o /dev/null http://127.0.0.1:8000/health
        surreal start --log info --bind 127.0.0.1:8000 --user $SURREAL_USER --pass $SURREAL_PASSWORD "rocksdb:$NOTEBOOK/surreal_data/mydatabase.db" > $LOGS/surrealdb.log 2>&1 &
        set SURREAL_PID $last_pid
        for i in (seq 40)
            curl -s -o /dev/null http://127.0.0.1:8000/health; and break
            sleep 0.5
        end
    end
    uv run --no-sync --env-file .env uvicorn api.main:app --host 127.0.0.1 --port 5055 > $LOGS/notebook-api.log 2>&1 &
    set API_PID $last_pid
end

# Start the Study folder service (the study app reads and writes its files through it)
if curl -s -o /dev/null http://127.0.0.1:5057/
    echo "The Study folder service is already running."
else
    echo "Starting the Study folder service..."
    $BASEN_ROOT/engine/.venv/bin/memory-engine serve &
    set STUDY_SERVICE_PID $last_pid
end

# Start the study app (dev server on http://localhost:1420)
if curl -s -o /dev/null http://localhost:1420/
    echo "The study app is already running."
else
    echo "Starting the study app..."
    cd $STUDY
    npm run dev &
    set STUDY_APP_PID $last_pid
    for i in (seq 60)
        curl -s -o /dev/null http://localhost:1420/; and break
        sleep 0.5
    end
end

xdg-open http://localhost:1420/ >/dev/null 2>&1
echo "The study app is at http://localhost:1420/"

# If this script started the app, wait for it (Ctrl+C) and then stop the rest of what it started.
# If the app was already running, leave what was started here running.
if set -q STUDY_APP_PID
    wait $STUDY_APP_PID
    if set -q STUDY_SERVICE_PID
        echo "Stopping the Study folder service..."
        kill $STUDY_SERVICE_PID 2>/dev/null
    end
    if set -q API_PID
        echo "Stopping Kratt's engine..."
        kill $API_PID 2>/dev/null
        sleep 2
    end
    if set -q SURREAL_PID
        kill $SURREAL_PID 2>/dev/null
    end
end
