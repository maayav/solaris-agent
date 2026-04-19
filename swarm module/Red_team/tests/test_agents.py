"""
Tests for agent nodes and graph construction.
"""

from agents.state import RedTeamState
from agents.graph import build_red_team_graph, create_initial_state, should_continue


class TestRedTeamState:
    """Test state schema."""

    def test_create_initial_state(self):
        state = create_initial_state(
            objective="Test recon",
            target="http://localhost:3000",
            max_iterations=3,
        )
        assert state["objective"] == "Test recon"
        assert state["target"] == "http://localhost:3000"
        assert state["phase"] == "planning"
        assert state["iteration"] == 0
        assert state["max_iterations"] == 3
        assert state["messages"] == []
        assert state["recon_results"] == []
        assert state["exploit_results"] == []
        assert state["needs_human_approval"] is False
        assert state["reflection_count"] == 0
        assert state["max_reflections"] == 3
        assert state["pending_exploit"] is None

    def test_create_initial_state_defaults(self):
        state = create_initial_state(
            objective="Default test",
            target="http://localhost:3000",
        )
        assert state["max_iterations"] == 5
        assert state["max_reflections"] == 3
        assert len(state["mission_id"]) == 8


class TestRouting:
    """Test graph routing logic."""

    def test_should_continue_complete(self):
        state = create_initial_state("test", "http://localhost:3000")
        state["phase"] = "complete"
        assert should_continue(state) == "report"  # Routes to report generation

    def test_should_continue_max_iterations(self):
        state = create_initial_state("test", "http://localhost:3000", max_iterations=3)
        state["iteration"] = 3
        assert should_continue(state) == "report"  # Routes to report generation

    def test_should_continue_exploitation(self):
        state = create_initial_state("test", "http://localhost:3000")
        state["phase"] = "exploitation"
        state["iteration"] = 1
        assert should_continue(state) == "exploit_only"

    def test_should_continue_recon(self):
        state = create_initial_state("test", "http://localhost:3000")
        state["phase"] = "recon"
        state["iteration"] = 1
        assert should_continue(state) == "continue"


class TestGraphConstruction:
    """Test that the LangGraph compiles successfully."""

    def test_build_graph(self):
        graph = build_red_team_graph()
        assert graph is not None
