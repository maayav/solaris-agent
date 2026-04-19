"""Test script for VibeCheck API.

This script tests the API endpoints with configurable repository URLs.
Set the TEST_REPO_URL environment variable to test with a different repository.
"""
import httpx
import asyncio
import os

# Default test repository - can be overridden via environment variable
DEFAULT_TEST_REPO = "https://github.com/juice-shop/juice-shop"
TEST_REPO_URL = os.environ.get("TEST_REPO_URL", DEFAULT_TEST_REPO)

# API base URL - can be overridden via environment variable
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")


async def test_scan_trigger():
    """Test the scan trigger endpoint."""
    async with httpx.AsyncClient() as client:
        # Test health endpoint
        print("Testing /health endpoint...")
        response = await client.get(f"{API_BASE_URL}/health")
        print(f"Health: {response.json()}")
        print()
        
        # Test scan trigger with configurable repo URL
        print(f"Testing /scan/trigger endpoint with repo: {TEST_REPO_URL}")
        response = await client.post(
            f"{API_BASE_URL}/scan/trigger",
            json={"repo_url": TEST_REPO_URL},
        )
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        print()
        
        return response.json()


if __name__ == "__main__":
    print(f"Using API: {API_BASE_URL}")
    print(f"Testing with repository: {TEST_REPO_URL}")
    print("-" * 50)
    asyncio.run(test_scan_trigger())
