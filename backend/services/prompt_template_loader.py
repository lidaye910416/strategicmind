"""
PromptTemplateLoader - Load prompt templates from resources

Supports Chinese and English templates, variable substitution.
Implements: US-020
"""

import os
import json
from typing import Dict, Any, Optional


class PromptTemplateLoader:
    """
    Loader for prompt templates stored in resources/prompts.
    
    Usage:
        loader = PromptTemplateLoader("backend/resources/prompts")
        template = loader.load("profile_individual")
        rendered = loader.render("profile_individual", variables={...})
    """
    
    def __init__(self, template_dir: str = "backend/resources/prompts"):
        self.template_dir = template_dir
    
    def load(self, name: str) -> str:
        """Load a template by name"""
        # Try .txt first, then .json
        for ext in [".txt", ".json"]:
            path = os.path.join(self.template_dir, f"{name}{ext}")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read()
        raise FileNotFoundError(f"Template not found: {name}")
    
    def render(self, name: str, variables: Dict[str, Any]) -> str:
        """Load and render a template with variables"""
        template = self.load(name)
        
        for key, value in variables.items():
            placeholder = "{" + key + "}"
            template = template.replace(placeholder, str(value))
        
        return template
    
    def load_json(self, name: str) -> Dict[str, Any]:
        """Load a JSON template"""
        path = os.path.join(self.template_dir, f"{name}.json")
        if not os.path.exists(path):
            raise FileNotFoundError(f"JSON template not found: {name}")
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    
    def list_templates(self) -> list:
        """List all available templates"""
        if not os.path.exists(self.template_dir):
            return []
        return [
            f[:-4] for f in os.listdir(self.template_dir)
            if f.endswith((".txt", ".json"))
        ]
