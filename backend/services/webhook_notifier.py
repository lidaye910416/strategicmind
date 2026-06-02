"""
WebhookNotifier - Send webhook notifications on pipeline completion

Notifies external systems of pipeline completion/failure.
Implements: US-056
"""

import json
import asyncio
from typing import Dict, Any, Optional
import aiohttp


class WebhookNotifier:
    """
    Sends webhook notifications on pipeline completion.
    
    Failures don't crash the pipeline.
    """
    
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
    
    async def notify(
        self,
        webhook_url: str,
        payload: Dict[str, Any],
    ) -> bool:
        """
        Send webhook notification.
        
        Args:
            webhook_url: Target webhook URL
            payload: JSON payload to send
            
        Returns:
            True if notification sent successfully
        """
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    webhook_url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=self.timeout),
                ) as response:
                    return 200 <= response.status < 300
        except Exception as e:
            print(f"Webhook notification failed: {e}")
            return False
    
    async def notify_completion(
        self,
        webhook_url: str,
        run_id: str,
        report_id: Optional[str] = None,
    ) -> bool:
        """Notify on completion"""
        return await self.notify(webhook_url, {
            "run_id": run_id,
            "status": "COMPLETED",
            "report_id": report_id,
        })
    
    async def notify_failure(
        self,
        webhook_url: str,
        run_id: str,
        error: str,
    ) -> bool:
        """Notify on failure"""
        return await self.notify(webhook_url, {
            "run_id": run_id,
            "status": "FAILED",
            "error": error,
        })
