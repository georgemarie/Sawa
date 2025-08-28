from django.urls import path
from . import views

urlpatterns = [
    path('', views.landing_home, name='landing_home'),
]
