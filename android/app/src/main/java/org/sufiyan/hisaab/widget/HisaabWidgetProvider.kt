package org.sufiyan.hisaab.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import org.sufiyan.hisaab.MainActivity
import org.sufiyan.hisaab.R

/**
 * Android Home Screen Widget for Hisaab.
 * Displays live liquid balance, today's expenses, and provides an instant "+ Add" button.
 */
class HisaabWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val balance = prefs.getString(KEY_BALANCE, "₹--") ?: "₹--"
        val expense = prefs.getString(KEY_EXPENSE, "₹0") ?: "₹0"

        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId, balance, expense)
        }
    }

    companion object {
        private const val PREFS_NAME = "hisaab_widget_prefs"
        private const val KEY_BALANCE = "widget_balance"
        private const val KEY_EXPENSE = "widget_expense"

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            balance: String,
            expense: String
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_hisaab)
            views.setTextViewText(R.id.widgetBalance, balance)
            views.setTextViewText(R.id.widgetTodayExpense, expense)

            // Intent to open app directly
            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("action", "open")
            }
            val openPendingIntent = PendingIntent.getActivity(
                context,
                101,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widgetRoot, openPendingIntent)

            // Intent for "+ Add" button
            val addIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("action", "add_expense")
            }
            val addPendingIntent = PendingIntent.getActivity(
                context,
                102,
                addIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widgetBtnAdd, addPendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        fun updateFromData(context: Context, dataJson: String) {
            try {
                val obj = JSONObject(dataJson)
                val balance = obj.optString("totalBalance", "₹--")
                val expense = obj.optString("todayExpense", "₹0")

                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.edit()
                    .putString(KEY_BALANCE, balance)
                    .putString(KEY_EXPENSE, expense)
                    .apply()

                updateAllWidgets(context)
            } catch (_: Exception) {
                // Ignore parse errors
            }
        }

        fun updateAllWidgets(context: Context) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val thisWidget = ComponentName(context, HisaabWidgetProvider::class.java)
            val allWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)

            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val balance = prefs.getString(KEY_BALANCE, "₹--") ?: "₹--"
            val expense = prefs.getString(KEY_EXPENSE, "₹0") ?: "₹0"

            for (id in allWidgetIds) {
                updateAppWidget(context, appWidgetManager, id, balance, expense)
            }
        }
    }
}
