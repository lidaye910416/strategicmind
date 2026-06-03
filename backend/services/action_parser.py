"""
ActionParser - Parse agent action output into structured objects

This service extracts parsing logic from SimulationRunner so it can
be reused across different components.

Supports: Twitter and Reddit platform formats
"""

import json
import re
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from enum import Enum
from datetime import datetime


class Platform(str, Enum):
    """Social media platforms"""
    TWITTER = "twitter"
    REDDIT = "reddit"


@dataclass
class AgentAction:
    """Parsed agent action"""
    platform: Platform
    agent_id: int
    agent_name: str
    action_type: str
    action_args: Dict[str, Any]
    content: str
    timestamp: Optional[str] = None
    round_num: int = 0
    success: bool = True
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "platform": self.platform.value,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "action_type": self.action_type,
            "action_args": self.action_args,
            "content": self.content,
            "timestamp": self.timestamp,
            "round_num": self.round_num,
            "success": self.success,
        }


class ActionParser:
    """
    Parser for structured agent action output.
    
    This service parses simulation output into structured
    AgentAction objects for downstream processing.
    
    Supported formats:
        - Twitter: CREATE_POST, LIKE_POST, REPOST, FOLLOW, etc.
        - Reddit: CREATE_POST, CREATE_COMMENT, LIKE_POST, etc.
    
    Usage:
        parser = ActionParser()
        actions = parser.parse_twitter(output_text)
        actions = parser.parse_reddit(output_text)
    """
    
    # Twitter action patterns
    TWITTER_PATTERNS = {
        "CREATE_POST": r"(?P<agent>\w+)\s+(?:posts?|tweets?|shares?)\s+(?:the\s+)?(?P<content>['\"].*?['\"]|\S+)",
        "LIKE_POST": r"(?P<agent>\w+)\s+(?:likes?|hearts?)\s+(?:post\s+)?#?(?P<target>\d+)",
        "REPOST": r"(?P<agent>\w+)\s+(?:reposts?|retweets?)\s+(?:post\s+)?#?(?P<target>\d+)",
        "FOLLOW": r"(?P<agent>\w+)\s+(?:follows?|starts?\s+following)\s+(?P<target>\w+)",
        "QUOTE_POST": r"(?P<agent>\w+)\s+(?:quote[- ]posts?)\s+(?:the\s+)?(?P<content>['\"].*?['\"])",
        "DO_NOTHING": r"(?P<agent>\w+)\s+(?:doesn[' ]t\s+)?(?:do(?:es)?\s+anything|is\s+inactive)",
    }
    
    # Reddit action patterns
    REDDIT_PATTERNS = {
        "CREATE_POST": r"(?P<agent>\w+)\s+(?:posts?|submits?)\s+(?:the\s+)?(?P<content>['\"].*?['\"]|\S+)",
        "CREATE_COMMENT": r"(?P<agent>\w+)\s+(?:comments?)\s+(?:on\s+)?(?:post\s+)?#?(?P<target>\d+)\s+(?:with\s+)?(?P<content>['\"].*?['\"])",
        "LIKE_POST": r"(?P<agent>\w+)\s+(?:upvotes?|likes?)\s+(?:post\s+)?#?(?P<target>\d+)",
        "DISLIKE_POST": r"(?P<agent>\w+)\s+(?:downvotes?|dislikes?)\s+(?:post\s+)?#?(?P<target>\d+)",
        "SEARCH_POSTS": r"(?P<agent>\w+)\s+(?:searches?|looks?\s+for)\s+(?P<content>\w+)",
        "DO_NOTHING": r"(?P<agent>\w+)\s+(?:doesn[' ]t\s+)?(?:do(?:es)?\s+anything|is\s+inactive)",
    }
    
    def __init__(self):
        """Initialize action parser"""
        self._twitter_compiled = {
            action: re.compile(pattern, re.IGNORECASE)
            for action, pattern in self.TWITTER_PATTERNS.items()
        }
        self._reddit_compiled = {
            action: re.compile(pattern, re.IGNORECASE)
            for action, pattern in self.REDDIT_PATTERNS.items()
        }
    
    def parse_twitter(self, output: str, round_num: int = 0) -> List[AgentAction]:
        """
        Parse Twitter simulation output.
        
        Args:
            output: Raw agent action text
            round_num: Current simulation round
            
        Returns:
            List of parsed AgentAction objects
        """
        actions = []
        lines = output.strip().split("\n")
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            for action_type, pattern in self._twitter_compiled.items():
                match = pattern.search(line)
                if match:
                    groups = match.groupdict()
                    
                    action = AgentAction(
                        platform=Platform.TWITTER,
                        agent_id=self._extract_agent_id(groups.get("agent", "")),
                        agent_name=groups.get("agent", "Unknown"),
                        action_type=action_type,
                        action_args=self._extract_action_args(action_type, groups),
                        content=groups.get("content", ""),
                        timestamp=datetime.now().isoformat(),
                        round_num=round_num,
                    )
                    actions.append(action)
                    break
        
        return actions
    
    def parse_reddit(self, output: str, round_num: int = 0) -> List[AgentAction]:
        """
        Parse Reddit simulation output.
        
        Args:
            output: Raw Reddit-style output text
            round_num: Current simulation round
            
        Returns:
            List of parsed AgentAction objects
        """
        actions = []
        lines = output.strip().split("\n")
        
        for line in lines:
            line = line.strip()
            if not line:
                continue
            
            for action_type, pattern in self._reddit_compiled.items():
                match = pattern.search(line)
                if match:
                    groups = match.groupdict()
                    
                    action = AgentAction(
                        platform=Platform.REDDIT,
                        agent_id=self._extract_agent_id(groups.get("agent", "")),
                        agent_name=groups.get("agent", "Unknown"),
                        action_type=action_type,
                        action_args=self._extract_action_args(action_type, groups),
                        content=groups.get("content", ""),
                        timestamp=datetime.now().isoformat(),
                        round_num=round_num,
                    )
                    actions.append(action)
                    break
        
        return actions
    
    def parse_json(self, data: Dict[str, Any], round_num: int = 0) -> List[AgentAction]:
        """
        Parse JSON format agent action output.
        
        Args:
            data: JSON data with actions array
            round_num: Current simulation round
            
        Returns:
            List of parsed AgentAction objects
        """
        actions = []
        actions_data = data.get("actions", data.get("results", []))
        
        for action_data in actions_data:
            platform_str = action_data.get("platform", "twitter").lower()
            platform = Platform.TWITTER if "twitter" in platform_str else Platform.REDDIT
            
            action = AgentAction(
                platform=platform,
                agent_id=action_data.get("agent_id", 0),
                agent_name=action_data.get("agent_name", "Unknown"),
                action_type=action_data.get("action_type", "UNKNOWN"),
                action_args=action_data.get("action_args", {}),
                content=action_data.get("content", ""),
                timestamp=action_data.get("timestamp"),
                round_num=round_num,
                success=action_data.get("success", True),
            )
            actions.append(action)
        
        return actions
    
    def _extract_agent_id(self, agent_name: str) -> int:
        """Extract numeric ID from agent name"""
        # Extract digits from agent name (e.g., "Agent_42" -> 42)
        digits = re.findall(r'\d+', agent_name)
        if digits:
            return int(digits[-1])
        return hash(agent_name) % 10000
    
    def _extract_action_args(self, action_type: str, groups: Dict[str, str]) -> Dict[str, Any]:
        """Extract action-specific arguments"""
        args = {}
        
        if "target" in groups:
            try:
                args["target_id"] = int(groups["target"])
            except (ValueError, TypeError):
                args["target_name"] = groups["target"]
        
        if "content" in groups:
            content = groups["content"]
            # Remove quotes if present
            if content and len(content) >= 2:
                if (content[0] == '"' and content[-1] == '"') or \
                   (content[0] == "'" and content[-1] == "'"):
                    content = content[1:-1]
            args["content"] = content
        
        return args
