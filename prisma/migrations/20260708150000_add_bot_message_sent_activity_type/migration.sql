-- Additive: new ActivityType value for outbound bot Chat messages. Safe on live data.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'BOT_MESSAGE_SENT';
