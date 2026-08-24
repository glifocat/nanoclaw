# OpenCode registration provisioning

NanoClaw can provision a new OpenCode agent group while approving an unwired messaging channel. This is creation-time configuration: it does not change the model of an existing conversation.

The approval flow is:

1. Choose **Connect new agent**.
2. Reply with the agent name.
3. Choose an OpenCode model provider.
4. For a native cloud provider, run the displayed host command to complete OpenCode's native `auth login` flow, then continue in the approval card. Custom OpenAI-compatible endpoints keep using OneCLI and skip this step.
5. Choose a model discovered from that provider.
6. Confirm creation and connection.

Only the final confirmation creates the group. NanoClaw then initializes its filesystem, sets the agent provider to `opencode`, snapshots the selected provider and model settings into the group's container configuration, creates the channel wiring, and replays the message that triggered registration.

## Model provider connections

NanoClaw stores provider connections, not a model allowlist. A connection contains:

- a display name;
- the OpenCode model-provider ID;
- a discovery type and optional API/model-list URLs;
- optional fallback context, output, and input-modality declarations for custom endpoints;
- an optional delivery mode and initial instructions.

Connections never contain API keys. Provider credentials stay in OneCLI and are injected into matching outbound HTTP requests.

Native OpenCode cloud credentials (including OAuth refresh tokens) are scoped to the agent group. OpenCode stores them in the group's private provider-state directory, which is mounted into every OpenCode session for that group. A new messaging session can therefore reuse and refresh the group's login, while another agent group cannot see it. Deleting an individual session does not delete the group's cloud login.

During registration, the native login first writes to a private pending state root. NanoClaw will not offer cloud models until the selected provider appears in OpenCode's own `auth.json`. Final confirmation atomically moves that state root into the newly created group; cancellation removes it.

For a built-in cloud provider, model discovery reads OpenCode's live Models.dev catalog:

```bash
ncl opencode-model-providers create \
  --name "OpenAI" \
  --provider-id openai

ncl opencode-model-providers create \
  --name "OpenRouter" \
  --provider-id openrouter
```

For a local or custom OpenAI-compatible endpoint, discovery calls its real `/models` endpoint through the OneCLI network path:

```bash
ncl opencode-model-providers create \
  --name "Spark local" \
  --provider-id openai \
  --discovery-type openai-compatible \
  --base-url https://inference.example.test/v1 \
  --context-limit 65536 \
  --output-limit 8192 \
  --input-modalities text,image \
  --delivery-mode tools-only
```

Set `--models-url` when model discovery is not exposed at `<base-url>/models`. OpenRouter is one possible model provider rather than the cloud abstraction.

Connections are enabled by default. Set `--enabled 0` with `update` to remove one from future registration cards without affecting groups that already selected it:

```bash
ncl opencode-model-providers list
ncl opencode-model-providers update <provider-connection-id> --enabled 0
```

Cloud discovery matches OpenCode's model picker source, but it represents the provider catalog rather than account-specific entitlements. OpenAI-compatible discovery reads the endpoint's actual loaded/available model list. When more than eight models match, the Mattermost wizard asks for a name/ID search before rendering buttons.

Registration copies the selected values into `container_configs.provider_settings`. Later provider edits therefore do not silently change existing groups.

## Add a local endpoint during registration

The provider card always includes **Local or custom endpoint**, so an operator does not need to create a reusable provider connection first. NanoClaw asks for:

1. the OpenAI-compatible base URL, including `/v1`;
2. the model context window in tokens;
3. the model discovered live from `<base-url>/models`.

The URL must be reachable from the agent container. For a server on the Docker host, use a container-reachable address such as `http://host.docker.internal:8891/v1`, not `localhost`. Inline endpoints use the OpenAI-compatible chat-completions transport, text input, tools-only delivery, and an output limit capped at 8192 tokens. Their settings are restart-safe while registration is pending and are copied directly into the new group at confirmation; they do not add a reusable row to `opencode-model-providers`.

## Restart behavior

The pending name, provider, model search, selected model, and confirmation step are stored in the central database. A host restart does not lose the wizard state. NanoClaw rechecks the live model list at selection and confirmation; if the provider or model disappears, it stops the attempt and asks the operator to restart registration.
