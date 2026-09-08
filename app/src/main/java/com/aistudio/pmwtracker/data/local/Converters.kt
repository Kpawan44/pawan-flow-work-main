package com.aistudio.pmwtracker.data.local

import androidx.room.TypeConverter
import com.aistudio.pmwtracker.model.Department
import com.aistudio.pmwtracker.model.JobCardStatus
import com.aistudio.pmwtracker.model.JobPriority

class Converters {
    @TypeConverter
    fun fromDepartment(department: Department): String = department.name

    @TypeConverter
    fun toDepartment(value: String): Department = try {
        Department.valueOf(value)
    } catch (e: Exception) {
        Department.PRODUCTION
    }

    @TypeConverter
    fun fromJobCardStatus(status: JobCardStatus): String = status.name

    @TypeConverter
    fun toJobCardStatus(value: String): JobCardStatus = try {
        JobCardStatus.valueOf(value)
    } catch (e: Exception) {
        JobCardStatus.PENDING
    }

    @TypeConverter
    fun fromJobPriority(priority: JobPriority): String = priority.name

    @TypeConverter
    fun toJobPriority(value: String): JobPriority = try {
        JobPriority.valueOf(value)
    } catch (e: Exception) {
        JobPriority.MEDIUM
    }
}
