from django.shortcuts import render, redirect
from .models import LandingContent

# Landing Page if user not authenticated else dashboard
def landing_home(request):
    if request.user.is_authenticated:
        return redirect("dashboard_home")
    return render(request, 'Landing Page/main.html')
