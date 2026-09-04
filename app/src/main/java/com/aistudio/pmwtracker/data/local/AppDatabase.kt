package com.aistudio.pmwtracker.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.aistudio.pmwtracker.model.*

@Database(
    entities = [
        JobCard::class,
        MaterialMovement::class,
        ProcessTransfer::class,
        OutsourceOrder::class,
        UserProfile::class
    ],
    version = 1,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun jobCardDao(): JobCardDao
    abstract fun materialMovementDao(): MaterialMovementDao
    abstract fun processTransferDao(): ProcessTransferDao
    abstract fun outsourceDao(): OutsourceDao
    abstract fun userDao(): UserDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "pmw_tracker_db"
                ).build()
                INSTANCE = instance
                instance
            }
        }
    }
}
