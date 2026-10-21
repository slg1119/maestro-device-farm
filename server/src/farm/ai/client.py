import base64
import json
from dataclasses import dataclass
from typing import Protocol

import openai


@dataclass(frozen=True)
class TextPart:
    text: str


@dataclass(frozen=True)
class ImagePart:
    data: bytes
    mime: str


ContentPart = TextPart | ImagePart


@dataclass(frozen=True)
class AiRequest:
    system: str
    parts: list[ContentPart]


@dataclass(frozen=True)
class AiResponse:
    data: dict
    input_tokens: int
    output_tokens: int
    model: str
    raw: str


RESULT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["files", "summary", "assumptions"],
    "properties": {
        "files": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["path", "content"],
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
        }},
        "summary": {"type": "string"},
        "assumptions": {"type": "array", "items": {"type": "string"}},
    },
}


class AiClient(Protocol):
    def complete(self, request: AiRequest, schema: dict) -> AiResponse: ...


class OpenAiClient:
    def __init__(self, api_key: str, model: str):
        self.model = model
        self.sdk = openai.OpenAI(api_key=api_key, timeout=120, max_retries=0)

    def complete(self, request: AiRequest, schema: dict) -> AiResponse:
        content = []
        for part in request.parts:
            if isinstance(part, TextPart):
                content.append({"type": "input_text", "text": part.text})
            else:
                encoded = base64.b64encode(part.data).decode("ascii")
                content.append({"type": "input_image", "image_url": f"data:{part.mime};base64,{encoded}"})
        response = self.sdk.responses.create(
            model=self.model, instructions=request.system,
            input=[{"role": "user", "content": content}],
            text={"format": {"type": "json_schema", "name": "maestro_changes", "schema": schema, "strict": True}},
        )
        return AiResponse(data=json.loads(response.output_text),
                          input_tokens=response.usage.input_tokens if response.usage else 0,
                          output_tokens=response.usage.output_tokens if response.usage else 0,
                          model=response.model, raw=response.output_text)

    def close(self):
        self.sdk.close()
