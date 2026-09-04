package com.aistudio.pmwtracker.model

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.serialization.Serializable

@Serializable
@Entity(tableName = "user_profiles")
data class UserProfile(
    @PrimaryKey val userId: String,
    val empId: String = "",
    val name: String,
    val email: String = "",
    val department: Department = Department.PRODUCTION,
    val role: String = "operator", // admin, operator, manager, viewer
    val active: Boolean = true
)
