package com.moontv.android.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.moontv.android.R
import com.moontv.android.viewmodel.LoginViewModel
import kotlinx.coroutines.launch

class LoginFragment : Fragment() {

    private val viewModel: LoginViewModel by viewModels()

    private lateinit var usernameInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginButton: Button
    private lateinit var errorText: TextView
    private lateinit var loading: ProgressBar

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.fragment_login, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        usernameInput = view.findViewById(R.id.usernameInput)
        passwordInput = view.findViewById(R.id.passwordInput)
        loginButton = view.findViewById(R.id.loginButton)
        errorText = view.findViewById(R.id.errorText)
        loading = view.findViewById(R.id.loginLoading)

        loginButton.setOnClickListener { doLogin() }

        passwordInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO) {
                doLogin()
                true
            } else false
        }

        // Focus password field by default (username is optional in localstorage mode)
        passwordInput.requestFocus()

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    loading.visibility = if (state.loading) View.VISIBLE else View.GONE
                    loginButton.isEnabled = !state.loading

                    if (state.error != null) {
                        errorText.text = state.error
                        errorText.visibility = View.VISIBLE
                    } else {
                        errorText.visibility = View.GONE
                    }

                    if (state.success) {
                        Toast.makeText(requireContext(), "登录成功", Toast.LENGTH_SHORT).show()
                        // Navigate to home
                        parentFragmentManager.beginTransaction()
                            .replace(R.id.fragmentContainer, HomeFragment())
                            .commit()
                    }
                }
            }
        }
    }

    private fun doLogin() {
        val password = passwordInput.text.toString().trim()
        if (password.isEmpty()) {
            errorText.text = "请输入密码"
            errorText.visibility = View.VISIBLE
            return
        }
        val username = usernameInput.text.toString().trim().ifEmpty { null }
        viewModel.login(password, username)
    }
}
