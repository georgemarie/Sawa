document.addEventListener('DOMContentLoaded', function() {
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileMenu = document.getElementById('mobile-menu');
    
    // Toggle mobile menu
    mobileMenuButton.addEventListener('click', function() {
      mobileMenu.classList.toggle('active');
      
      // Change icon based on menu state
      const menuIcon = mobileMenuButton.querySelector('.menu-icon');
      if (mobileMenu.classList.contains('active')) {
        menuIcon.setAttribute('d', 'M6 18L18 6M6 6l12 12');
      } else {
        menuIcon.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
      }
    });
    
    // Close menu when clicking on a link
    document.querySelectorAll('.mobile-nav a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('active');
        const menuIcon = mobileMenuButton.querySelector('.menu-icon');
        menuIcon.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
      });
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(event) {
      if (!mobileMenu.contains(event.target) && 
          event.target !== mobileMenuButton && 
          !mobileMenuButton.contains(event.target)) {
        mobileMenu.classList.remove('active');
        const menuIcon = mobileMenuButton.querySelector('.menu-icon');
        menuIcon.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
      }
    });
  });