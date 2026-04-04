import logging
import os
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from pymongo import MongoClient

# ================= CONFIG =================
BOT_TOKEN = os.getenv("BOT_TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID"))
MONGO_URL = os.getenv("MONGO_URL")

# ================= DB =================
client = MongoClient(MONGO_URL)
db = client["chatbot"]
users_col = db["users"]
ban_col = db["banned"]

# ================= LOGGING =================
logging.basicConfig(level=logging.INFO)

# ================= START =================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    # Save user
    if not users_col.find_one({"user_id": user.id}):
        users_col.insert_one({"user_id": user.id})

    await update.message.reply_text("👋 Welcome! Admin se baat karne ke liye message bhejo.")

# ================= USER MESSAGE =================
async def user_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user

    # Check ban
    if ban_col.find_one({"user_id": user.id}):
        return await update.message.reply_text("🚫 You are banned.")

    # Forward to admin
    await context.bot.send_message(
        chat_id=ADMIN_ID,
        text=f"📩 Message from {user.first_name} ({user.id}):\n\n{update.message.text}"
    )

    await update.message.reply_text("✅ Message sent to admin!")

# ================= ADMIN REPLY =================
async def reply(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return

    try:
        user_id = int(context.args[0])
        msg = " ".join(context.args[1:])

        await context.bot.send_message(chat_id=user_id, text=f"💬 Admin: {msg}")
        await update.message.reply_text("✅ Reply sent!")

    except:
        await update.message.reply_text("❌ Use: /reply user_id message")

# ================= BROADCAST =================
async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return

    msg = " ".join(context.args)
    users = users_col.find()

    count = 0
    for user in users:
        try:
            await context.bot.send_message(chat_id=user["user_id"], text=f"📢 {msg}")
            count += 1
        except:
            pass

    await update.message.reply_text(f"✅ Sent to {count} users")

# ================= BAN =================
async def ban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return

    user_id = int(context.args[0])
    ban_col.insert_one({"user_id": user_id})

    await update.message.reply_text("🚫 User banned")

# ================= UNBAN =================
async def unban(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ADMIN_ID:
        return

    user_id = int(context.args[0])
    ban_col.delete_one({"user_id": user_id})

    await update.message.reply_text("✅ User unbanned")

# ================= MAIN =================
def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("reply", reply))
    app.add_handler(CommandHandler("broadcast", broadcast))
    app.add_handler(CommandHandler("ban", ban))
    app.add_handler(CommandHandler("unban", unban))

    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_message))

    print("🚀 Bot running...")
    app.run_polling()

if __name__ == "__main__":
    main()
