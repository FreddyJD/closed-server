# Images Directory

## Hero Background Image

Place your `hero-background.jpg` image in this directory:

```
battlecards-server/public/images/hero-background.jpg
```

**Requirements:**
- Filename: `hero-background.jpg`
- Recommended size: 1920x1080 or higher
- Format: JPG or PNG
- Dark/dramatic image works best (overlay will be applied)

**Current Setup:**
- ✅ Fallback gradient background if image is missing
- ✅ Responsive design (fixed attachment on desktop, scroll on mobile)
- ✅ Dark overlay for text readability
- ✅ Full viewport height on marketing pages
- ✅ Proper navbar transparency over hero

The hero background will automatically appear on:
- Homepage (`/`)
- Login page (`/login`) 
- Auth success page (`/auth/success`)

Dashboard pages will maintain the white background with proper navbar spacing. 