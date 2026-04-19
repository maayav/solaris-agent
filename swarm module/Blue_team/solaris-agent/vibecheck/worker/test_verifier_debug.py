"""Test LLM verifier with detailed output."""
import asyncio
import sys
import logging
import os

# Add parent directory to path (vibecheck folder)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging to see all output
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
)

from worker.llm_verifier import verify_candidate

async def test():
    candidate = {
        'vuln_type': 'sql_injection',
        'file_path': 'server.ts',
        'line_start': 20,
        'line_end': 25,
        'code_snippet': "const query = 'SELECT * FROM users WHERE id = ' + req.params.id; db.query(query);",
        'rule_id': 'test-rule'
    }
    
    print('=' * 80)
    print('Testing LLM verifier with SQL injection candidate...')
    print('=' * 80)
    result = await verify_candidate(candidate)
    print('\n' + '=' * 80)
    print('FINAL RESULT:')
    print('=' * 80)
    for key, value in result.items():
        print(f'  {key}: {value}')

if __name__ == "__main__":
    asyncio.run(test())
