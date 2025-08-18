WLink Adapter

Key changes:
- Outbound attribution now maps the agent by WhatsApp instance phone to the exact GHL user (no global default fallback). Messages from agents render on the agent side with their avatar/name in GHL Conversations.
- Added robust user listing and phone matching with logging.
- Avoids assigning owner/default userIds to prevent misrendering on the contact side.

