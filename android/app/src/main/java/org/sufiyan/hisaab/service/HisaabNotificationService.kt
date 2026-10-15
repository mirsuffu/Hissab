package org.sufiyan.hisaab.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.sufiyan.hisaab.MainActivity
import org.sufiyan.hisaab.R

/**
 * Manages the persistent Quick-Glance notification in the Android status shade.
 * Keeps current day expenses and total liquid balance visible with instant shortcut triggers.
 */
object HisaabNotificationService {

    private const val NOTIFICATION_ID = 1001
    private const val PREFS_NAME = "hisaab_notification_prefs"
    private const val KEY_LAST_EXPENSE = "last_expense"
    private const val KEY_LAST_BALANCE = "last_balance"

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = context.getString(R.string.notification_channel_name)
            val descriptionText = context.getString(R.string.notification_channel_desc)
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(
                context.getString(R.string.notification_channel_id),
                name,
                importance
            ).apply {
                description = descriptionText
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun updateQuickGlance(context: Context, todayExpense: String, totalBalance: String) {
        createNotificationChannel(context)

        // Persist values
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_LAST_EXPENSE, todayExpense)
            .putString(KEY_LAST_BALANCE, totalBalance)
            .apply()

        // 1. PendingIntent to open app normally
        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("action", "open")
        }
        val openPendingIntent = PendingIntent.getActivity(
            context,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 2. PendingIntent for "+ Expense" action
        val addExpenseIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("action", "add_expense")
        }
        val addExpensePendingIntent = PendingIntent.getActivity(
            context,
            1,
            addExpenseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 3. PendingIntent for "+ Quick" action
        val quickExpenseIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("action", "quick_expense")
        }
        val quickExpensePendingIntent = PendingIntent.getActivity(
            context,
            2,
            quickExpenseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val channelId = context.getString(R.string.notification_channel_id)
        val titleText = "Hisaab · Balance $totalBalance"
        val bodyText = "Today's Spent: $todayExpense · Tap to record new entry"

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.ic_stat_hisaab)
            .setContentTitle(titleText)
            .setContentText(bodyText)
            .setStyle(NotificationCompat.BigTextStyle().bigText("Total Balance: $totalBalance\nToday's Spent: $todayExpense"))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(openPendingIntent)
            .addAction(R.drawable.ic_stat_hisaab, context.getString(R.string.action_add_expense), addExpensePendingIntent)
            .addAction(R.drawable.ic_stat_hisaab, context.getString(R.string.action_quick_expense), quickExpensePendingIntent)
            .setColor(context.getColor(R.color.primary))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()

        try {
            val notificationManager = NotificationManagerCompat.from(context)
            notificationManager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // Android 13+ POST_NOTIFICATIONS permission not granted yet
        }
    }

    fun cancel(context: Context) {
        val notificationManager = NotificationManagerCompat.from(context)
        notificationManager.cancel(NOTIFICATION_ID)
    }
}
