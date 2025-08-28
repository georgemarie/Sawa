from django.urls import path, include
from . import views

urlpatterns = [
     path('login/', views.user_login, name='login'),
     path('accounts/login/', views.user_login, name='login'),
     path('register/', views.register, name='register'),
     path('logout/', views.user_logout, name='logout'),
     path('forget-password/', views.forget_password, name="forget_password"),
     path('send-otp/', views.send_otp, name='send_otp'),
     path('verify-otp/', views.verify_otp, name='verify_otp'),
     path('profile/', views.profile_view, name='profile'),
     path('profile/update-password/', views.update_password, name='update_password'),
     path('profile/update_image/', views.update_profile_image,
          name='update_profile_image'),
     path('profile/delete_image/', views.delete_profile_image,
          name='delete_profile_image'),
     path('get_user_gender/<int:user_id>/',
          views.get_user_gender, name='get_user_gender'),
     path('settings/', views.settings_view, name = "settings"),
     path('settings/update/', views.update_settings_view, name='update_settings'),
     path('get_user_settings/<int:user_id>/',
          views.get_user_settings, name='get_user_settings'),
]
