import json

import httpx
import openai

from farm.ai.client import RESULT_SCHEMA, AiRequest, ImagePart, OpenAiClient, TextPart


def test_responses_adapter_sends_structured_text_and_image_and_reads_usage(monkeypatch):
    seen = []
    data = {"files": [], "summary": "no changes", "assumptions": []}

    def respond(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "resp_fake", "object": "response", "created_at": 0, "status": "completed", "model": "fake-model",
            "output": [{"id": "msg_fake", "type": "message", "role": "assistant", "status": "completed",
                        "content": [{"type": "output_text", "text": json.dumps(data), "annotations": []}]}],
            "usage": {"input_tokens": 123, "output_tokens": 45, "total_tokens": 168},
        })

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        sdk = openai.OpenAI(api_key="test-only", http_client=http)
        monkeypatch.setattr(openai, "OpenAI", lambda **kwargs: sdk)
        client = OpenAiClient("test-only", "configured-model")
        try:
            result = client.complete(AiRequest("rules", [TextPart("user text"), ImagePart(b"png", "image/png")]),
                                     RESULT_SCHEMA)
        finally:
            client.close()
    assert result.data == data
    assert (result.input_tokens, result.output_tokens, result.model) == (123, 45, "fake-model")
    assert seen == [{
        "model": "configured-model", "instructions": "rules",
        "input": [{"role": "user", "content": [
            {"type": "input_text", "text": "user text"},
            {"type": "input_image", "image_url": "data:image/png;base64,cG5n"},
        ]}],
        "text": {"format": {"type": "json_schema", "name": "maestro_changes", "schema": RESULT_SCHEMA, "strict": True}},
    }]
