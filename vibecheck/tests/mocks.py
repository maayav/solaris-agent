"""
Mock implementations for regression testing.
Provides MockRedis and MockSupabase with interfaces compatible with scan_worker.py.
"""

import json
from typing import Any
from pathlib import Path


class MockRedis:
    """Mock Redis client for testing without a running Redis instance."""

    def __init__(self):
        self._data: dict[str, Any] = {}
        self._streams: dict[str, list[dict]] = {}
        self._groups: dict[str, dict] = {}

    async def xadd(self, stream: str, data: dict) -> str:
        if stream not in self._streams:
            self._streams[stream] = []
        entry_id = f"{len(self._streams[stream])}-{0}"
        entry = {k: v for k, v in data.items()}
        self._streams[stream].append(entry)
        return entry_id

    async def xgroup_create(self, stream: str, group: str, id: str = "$"):
        if stream not in self._groups:
            self._groups[stream] = {}
        self._groups[stream][group] = {"created": True}

    async def xreadgroup(
        self,
        group: str,
        consumer: str,
        streams: dict[str, str],
        count: int | None = None,
    ) -> list[tuple[str, list[tuple[str, dict]]]]:
        results = []
        for stream, last_id in streams.items():
            if stream in self._streams:
                entries = [
                    (f"{i}-{0}", entry)
                    for i, entry in enumerate(self._streams[stream])
                ]
                results.append((stream, entries))
        return results

    async def ping(self) -> bool:
        return True

    async def set(self, key: str, value: str | bytes):
        self._data[key] = value

    async def get(self, key: str) -> str | bytes | None:
        return self._data.get(key)

    async def publish(self, channel: str, message: str):
        pass


class MockSupabase:
    """Mock Supabase client for testing without a running Supabase instance."""

    def __init__(self):
        self._tables: dict[str, list[dict]] = {
            "scans": [],
            "vulnerabilities": [],
        }

    def table(self, name: str):
        return MockTable(name, self._tables[name])

    async def insert(self, table: str, record: dict) -> dict:
        if table not in self._tables:
            self._tables[table] = []
        record["id"] = len(self._tables[table]) + 1
        self._tables[table].append(record)
        return record

    async def update(self, table: str, filters: dict, record: dict) -> dict:
        return record

    async def upsert(self, table: str, record: dict) -> dict:
        return record


class MockTable:
    """Mock Supabase table interface."""

    def __init__(self, name: str, data: list[dict]):
        self._name = name
        self._data = data

    def insert(self, record: dict):
        record["id"] = len(self._data) + 1
        self._data.append(record)
        return MockInsertResult(record)

    def select(self, *columns):
        return MockQueryBuilder(self._data)

    def update(self, record: dict):
        return MockQueryBuilder(self._data, update_record=record)

    def upsert(self, record: dict):
        return MockQueryBuilder(self._data, upsert_record=record)


class MockQueryBuilder:
    """Minimal mock for Supabase query builder."""

    def __init__(self, data: list[dict], update_record: dict | None = None, upsert_record: dict | None = None):
        self._data = data
        self._update_record = update_record
        self._upsert_record = upsert_record

    def eq(self, column: str, value: Any):
        filtered = [r for r in self._data if r.get(column) == value]
        return MockQueryBuilder(filtered, self._update_record, self._upsert_record)

    def in_(self, column: str, values: list):
        filtered = [r for r in self._data if r.get(column) in values]
        return MockQueryBuilder(filtered, self._update_record, self._upsert_record)

    async def execute(self) -> list[dict]:
        if self._update_record:
            for record in self._data:
                record.update(self._update_record)
        if self._upsert_record:
            for i, record in enumerate(self._data):
                if record.get("id") == self._upsert_record.get("id"):
                    self._data[i] = self._upsert_record
                    return [self._upsert_record]
            self._data.append(self._upsert_record)
        return self._data


class MockInsertResult:
    """Mock insert result."""

    def __init__(self, record: dict):
        self._record = record

    async def execute(self) -> dict:
        return self._record
