package com.moontv.android.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.moontv.android.api.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class LoginViewModel(app: Application) : AndroidViewModel(app) {

    private val api = ApiClient.getInstance(app)

    private val _state = MutableStateFlow(LoginState())
    val state: StateFlow<LoginState> = _state

    fun login(password: String, username: String?) {
        if (_state.value.loading) return
        _state.value = _state.value.copy(loading = true, error = null)

        viewModelScope.launch {
            try {
                val resp = api.login(password, username)
                if (resp.ok) {
                    _state.value = _state.value.copy(loading = false, success = true)
                } else {
                    _state.value = _state.value.copy(
                        loading = false,
                        error = resp.error ?: "登录失败"
                    )
                }
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    loading = false,
                    error = "网络错误: ${e.message}"
                )
            }
        }
    }
}

data class LoginState(
    val loading: Boolean = false,
    val success: Boolean = false,
    val error: String? = null
)
