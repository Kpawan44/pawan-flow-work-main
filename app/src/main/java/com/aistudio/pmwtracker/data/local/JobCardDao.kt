package com.aistudio.pmwtracker.data.local

import androidx.room.*
import com.aistudio.pmwtracker.model.Department
import com.aistudio.pmwtracker.model.JobCard
import kotlinx.coroutines.flow.Flow

@Dao
interface JobCardDao {
    @Query("SELECT * FROM job_cards ORDER BY updatedAt DESC")
    fun getAllJobCards(): Flow<List<JobCard>>

    @Query("SELECT * FROM job_cards WHERE jobCardNo = :jobCardNo")
    fun getJobCard(jobCardNo: String): Flow<JobCard?>

    @Query("SELECT * FROM job_cards WHERE currentDepartment = :dept ORDER BY priority DESC, createdAt ASC")
    fun getJobCardsByDepartment(dept: Department): Flow<List<JobCard>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertJobCard(jobCard: JobCard)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertJobCards(jobCards: List<JobCard>)

    @Update
    suspend fun updateJobCard(jobCard: JobCard)

    @Delete
    suspend fun deleteJobCard(jobCard: JobCard)

    @Query("DELETE FROM job_cards WHERE jobCardNo = :jobCardNo")
    suspend fun deleteByJobCardNo(jobCardNo: String)
}
