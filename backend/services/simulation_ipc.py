"""
SimulationIPC - asyncio-based event bus for simulation IPC

This replaces polling-based IPC with an asyncio.Queue event bus,
making it testable and event-driven.

Replaces: Polling-based IPC in SimulationRunner
"""

import asyncio
from typing import Dict, Any, Callable, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from uuid import uuid4


class MessageType(str, Enum):
    """IPC message types"""
    COMMAND = "command"
    EVENT = "event"
    STATUS = "status"
    RESULT = "result"
    ERROR = "error"


@dataclass
class IPCMessage:
    """IPC message structure"""
    id: str = field(default_factory=lambda: str(uuid4()))
    type: MessageType = MessageType.EVENT
    command: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type.value,
            "command": self.command,
            "data": self.data,
            "timestamp": self.timestamp,
        }


class CommandType(str, Enum):
    """Simulation control commands"""
    START = "start"
    PAUSE = "pause"
    RESUME = "resume"
    STOP = "stop"
    GET_STATUS = "get_status"


@dataclass 
class IPCResponse:
    """Response to IPC command"""
    success: bool
    message_id: str
    data: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


class SimulationIPC:
    """
    asyncio-based event bus for simulation IPC.
    
    This replaces polling-based IPC with event-driven messaging
    using asyncio.Queue.
    
    Features:
        - Async message queue
        - Subscribe/unsubscribe to message types
        - Command-response pattern
        - Event broadcasting
    
    Usage:
        ipc = SimulationIPC()
        
        # Subscribe to events
        async def on_round_complete(data):
            print(f"Round {data['round']} complete")
        ipc.subscribe(MessageType.EVENT, on_round_complete)
        
        # Send commands
        response = await ipc.send_command(CommandType.PAUSE, run_id="123")
        
        # Publish events
        await ipc.publish(MessageType.EVENT, {"round": 5})
    """
    
    def __init__(self):
        """Initialize IPC event bus"""
        self._queue: asyncio.Queue[IPCMessage] = asyncio.Queue()
        self._subscribers: Dict[MessageType, List[Callable]] = {}
        self._response_futures: Dict[str, asyncio.Future] = {}
        self._running = False
    
    async def start(self) -> None:
        """Start the IPC event loop"""
        self._running = True
        while self._running:
            try:
                message = await asyncio.wait_for(self._queue.get(), timeout=0.1)
                await self._dispatch(message)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                print(f"IPC error: {e}")
    
    async def stop(self) -> None:
        """Stop the IPC event loop"""
        self._running = False
    
    def subscribe(
        self,
        message_type: MessageType,
        handler: Callable[[Dict[str, Any]], Any]
    ) -> None:
        """
        Subscribe to a message type.
        
        Args:
            message_type: Type of messages to receive
            handler: Async function to handle messages
        """
        if message_type not in self._subscribers:
            self._subscribers[message_type] = []
        self._subscribers[message_type].append(handler)
    
    def unsubscribe(
        self,
        message_type: MessageType,
        handler: Callable
    ) -> bool:
        """
        Unsubscribe from a message type.
        
        Returns:
            True if unsubscribed successfully
        """
        if message_type in self._subscribers:
            try:
                self._subscribers[message_type].remove(handler)
                return True
            except ValueError:
                pass
        return False
    
    async def send_command(
        self,
        command: CommandType,
        **data
    ) -> IPCResponse:
        """
        Send a command and wait for response.
        
        Args:
            command: Command to send
            **data: Command data
            
        Returns:
            IPCResponse from handler
        """
        message = IPCMessage(
            type=MessageType.COMMAND,
            command=command.value,
            data=data,
        )
        
        # Create future for response
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._response_futures[message.id] = future
        
        # Queue the command
        await self._queue.put(message)
        
        # Wait for response
        try:
            response = await asyncio.wait_for(future, timeout=30.0)
            return response
        except asyncio.TimeoutError:
            return IPCResponse(
                success=False,
                message_id=message.id,
                error="Command timeout",
            )
        finally:
            self._response_futures.pop(message.id, None)
    
    async def publish(
        self,
        message_type: MessageType,
        data: Dict[str, Any]
    ) -> None:
        """
        Publish an event to all subscribers.
        
        Args:
            message_type: Type of event
            data: Event data
        """
        message = IPCMessage(
            type=message_type,
            data=data,
        )
        await self._queue.put(message)
    
    async def _dispatch(self, message: IPCMessage) -> None:
        """Dispatch message to subscribers"""
        # Notify subscribers
        handlers = self._subscribers.get(message.type, [])
        for handler in handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(message.data)
                else:
                    handler(message.data)
            except Exception as e:
                print(f"Handler error: {e}")
        
        # Handle command responses
        if message.type == MessageType.COMMAND:
            # Command responses handled separately
            pass
        
        # Handle status responses
        if message.type == MessageType.STATUS and message.id in self._response_futures:
            future = self._response_futures[message.id]
            if not future.done():
                future.set_result(IPCResponse(
                    success=True,
                    message_id=message.id,
                    data=message.data,
                ))
    
    def get_queue_size(self) -> int:
        """Get current queue size"""
        return self._queue.qsize()


# Client-side IPC for external use
class SimulationIPCClient:
    """
    Client for connecting to simulation IPC.
    
    Usage:
        client = SimulationIPCClient()
        await client.connect()
        await client.send_command(CommandType.PAUSE, run_id="123")
        await client.disconnect()
    """
    
    def __init__(self, url: Optional[str] = None):
        self.url = url or "ws://localhost:8000/ws/simulation"
        self._connected = False
        self._handlers: Dict[str, Callable] = {}
    
    async def connect(self) -> bool:
        """Connect to IPC server"""
        # Placeholder - would use websockets in production
        self._connected = True
        return True
    
    async def disconnect(self) -> None:
        """Disconnect from IPC server"""
        self._connected = False
    
    async def send_command(self, command: CommandType, **data) -> Dict[str, Any]:
        """Send command to simulation"""
        # Placeholder - would use websockets
        return {"success": True, "command": command.value}
    
    def subscribe(self, event: str, handler: Callable) -> None:
        """Subscribe to event"""
        self._handlers[event] = handler
    
    def unsubscribe(self, event: str) -> bool:
        """Unsubscribe from event"""
        if event in self._handlers:
            del self._handlers[event]
            return True
        return False
