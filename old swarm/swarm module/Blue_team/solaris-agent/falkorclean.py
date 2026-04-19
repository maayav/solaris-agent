from falkordb import FalkorDB

db = FalkorDB(host="localhost", port=6379)
# List all graphs
graphs = db.list_graphs()
# Delete orphaned scan graphs
for g in graphs:
    if g.startswith("scan_"):
        db.select_graph(g).delete()
        print(f"Deleted {g}")
