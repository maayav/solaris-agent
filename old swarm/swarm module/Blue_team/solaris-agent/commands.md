backend:
python -m api.main
py -m uvicorn api.main:app --host 0.0.0.0 --port 8002 --app-dir vibecheck

python -c "
import redis
r = redis.from_url('redis://localhost:6380')

# How many messages in the stream
length = r.xlen('scan_queue')
print(f'Jobs in scan_queue: {length}')

# Show the latest message
msgs = r.xrevrange('scan_queue', count=3)
for id, data in msgs:
    print(f'  ID: {id}')
    print(f'  Data: {data}')

# Show pending (claimed but not ACKed)
pending = r.xpending('scan_queue', 'scan_workers')
print(f'Pending (stuck): {pending}')
"



python -c "
import redis
r = redis.from_url('redis://localhost:6380')

# ACK all 4 stuck pending messages
stuck_ids = [
    '1772213291460-0'
]
for id in stuck_ids:
    r.xack('scan_queue', 'scan_workers', id)
    print(f'ACKed {id}')

# Delete the entire stream to wipe all 19 jobs
r.delete('scan_queue')
print('Stream deleted - clean slate')
"
Get-WmiObject Win32_Process | Where-Object {$_.CommandLine -like "*scan_worker*"} | Select-Object ProcessId, CommandLine

Stop-Process -Id 20088 -Force
