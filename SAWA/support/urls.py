from django.urls import path
from . import views



urlpatterns = [
    # path('', views.support_home, name='support_home'),
    path('help/', views.help_view, name='help'),
    # path('setting/', views.setting_view, name='setting'),
]
