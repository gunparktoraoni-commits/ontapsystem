# PDF Gallery Components

This directory contains components for displaying PDF files in bizcard galleries.

## Components

### PDFViewerModal.tsx

Full-featured PDF viewer modal with the following features:

- **PDF Rendering**: Uses `react-pdf` library to render PDFs
- **Zoom Controls**: Zoom in/out from 50% to 200%
- **Page Navigation**: Navigate between pages with prev/next buttons
- **Page Counter**: Display current page number and total pages
- **Download**: Download PDF directly from viewer
- **Close**: Close button or ESC key
- **Responsive**: Works on desktop, tablet, and mobile

#### Usage

```typescript
import { PDFViewerModal } from './PDFViewerModal';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <>
      <button onClick={() => setIsOpen(true)}>View PDF</button>
      
      <PDFViewerModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        pdfUrl="https://example.com/document.pdf"
        title="Document Title"
        description="Optional description"
      />
    </>
  );
}
```

#### Props

```typescript
interface PDFViewerModalProps {
  isOpen: boolean;              // Modal visibility
  onClose: () => void;          // Close handler
  pdfUrl: string;              // URL to PDF file
  title?: string;              // PDF title (displayed in header)
  description?: string;        // PDF description (displayed in header)
}
```

#### Dependencies

- `react`
- `react-pdf`
- `lucide-react` (for icons)

### PDFGalleryItem.tsx

PDF gallery card component that displays in the gallery carousel.

- **Theme Integration**: Uses theme colors and styling
- **PDF Icon**: Displays PDF icon with visual indicator
- **Hover Effects**: Shows action buttons on hover
- **Responsive**: Per-theme sizing and layouts
- **Actions**: View and download buttons
- **Accessibility**: ARIA labels and keyboard navigation

#### Usage

```typescript
import { PDFGalleryItem } from './PDFGalleryItem';

function MyGallery() {
  return (
    <PDFGalleryItem
      id={1}
      url="https://example.com/document.pdf"
      title="Document Title"
      description="Optional description"
      accent="#3b82f6"
      glass="rgba(59,130,246,0.08)"
      textMuted="#64748b"
      variant="ocean-gradient"
    />
  );
}
```

#### Props

```typescript
interface PDFGalleryItemProps {
  id: number;                    // Unique PDF ID
  url: string;                   // PDF URL
  title?: string;                // PDF title
  description?: string;          // PDF description
  cardRadius?: string;           // Border radius (default: 'rounded-2xl')
  glass?: string;                // Glass morphism color
  textMuted?: string;            // Muted text color
  accent?: string;               // Accent color
  mini?: boolean;                // Mini mode for small displays
  variant?: string;              // Theme variant name
}
```

#### Theme Variants

The component supports per-theme styling:

- `ocean-gradient`: 240px width, 4:3 aspect ratio
- `royal-purple`: 200px width, 3:4 aspect ratio (portrait)
- `elegant-dark`: 220px width, square aspect
- `default`: 220px width, square aspect

### PDFCarousel

Component that displays multiple PDFs in a responsive carousel.

Located in `../shared.tsx` - see that file for documentation.

## File Structure

```
app/themes/components/
├── PDFViewerModal.tsx      (347 lines)
├── PDFGalleryItem.tsx      (177 lines)
└── README_PDF.md           (this file)

app/themes/
└── shared.tsx              (contains PDFCarousel)
```

## Integration in Themes

To add PDF support to a theme:

### 1. Update Imports

```typescript
import {
  // ... existing imports
  PDFCarousel,
  buildPdfItems,
} from '../../shared';
```

### 2. Initialize PDF Data

```typescript
const pdfs = buildPdfItems(d);
```

### 3. Render PDFs Section

```typescript
{isGalleryEnabled(d, mini) && pdfs.length > 0 && (
  <div style={{ marginBottom: 14 }}>
    <Card delay={115} mini={compact}>
      <SL label="Documents" />
      <PDFCarousel
        items={pdfs}
        accent={C.accent}
        glass={C.glass}
        textMuted={C.muted}
        mini={compact}
        variant="your-theme-name"
      />
    </Card>
  </div>
)}
```

## Styling

### Color Variables

Each theme should provide:

- `accent`: Primary accent color
- `glass`: Glass morphism background
- `textMuted`: Muted text color
- `border` (optional): Border color

### Example Theme Integration

```typescript
const C = {
  accent: '#cc6a30',        // Warm orange
  glass: 'rgba(255,236,196,0.02)',
  textMuted: '#a89880',
  border: 'rgba(195,145,65,0.08)',
};

<PDFCarousel
  items={pdfs}
  accent={C.accent}
  glass={C.glass}
  textMuted={C.muted}
  mini={compact}
  variant="elegant-dark"
/>
```

## Performance Considerations

- **Lazy Loading**: PDF.js is dynamically imported
- **Bundle Impact**: ~35KB gzipped
- **Load on Demand**: PDF only loads when modal opens
- **Caching**: PDFs cached by browser after first load
- **Memory**: Cleaned up when modal closes

## Accessibility

- ✅ Keyboard navigation (Tab, Enter, ESC)
- ✅ ARIA labels on all controls
- ✅ Screen reader compatible
- ✅ Color contrast WCAG AA compliant
- ✅ Focus indicators visible
- ✅ Touch targets 44x44px minimum

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- iOS Safari 14+
- Chrome Android 90+

## Troubleshooting

### PDF doesn't display

1. Check the PDF URL is correct
2. Verify CORS headers if cross-origin
3. Check browser console for errors
4. Ensure PDF.js worker is available

### Modal doesn't open

1. Verify `isOpen` state is true
2. Check `onClose` handler is defined
3. Check for z-index conflicts
4. Verify modal DOM is rendered

### Zoom not working

1. Ensure PDF is loaded
2. Check zoom value is within 50-200%
3. Verify PDF.js is properly initialized

### Styling doesn't match theme

1. Check `variant` prop value
2. Verify theme colors are passed
3. Check CSS media queries
4. Inspect element in DevTools

## API Reference

### buildPdfItems(data)

```typescript
function buildPdfItems(d: PortfolioData): PDFItem[]
```

Extracts PDF items from portfolio data.

**Returns**: Array of PDF items

### isPdfMimeOrUrl(mimeType, url)

```typescript
function isPdfMimeOrUrl(mimeType: unknown, url: string): boolean
```

Detects if a file is a PDF.

**Returns**: true if PDF, false otherwise

### PDFItem Type

```typescript
export type PDFItem = {
  id: number;              // Unique identifier
  src: string;             // PDF URL
  title?: string;          // PDF title
  description?: string;    // PDF description
};
```

## Testing

### Unit Tests

Test individual components:

```typescript
// Test PDFViewerModal
- Opens and closes correctly
- Zoom controls work
- Page navigation works
- Download button works
- ESC key closes modal

// Test PDFGalleryItem
- Renders with correct styling
- Click opens modal
- Download button works
- Title/description display
- Responsive sizing
```

### Integration Tests

Test with themes:

```typescript
// Test with each theme
- PDF appears in gallery
- Theme colors applied
- Responsive on all breakpoints
- Modal works from theme
- No style conflicts
```

### E2E Tests

Test full user flow:

```typescript
1. User uploads PDF
2. PDF appears in gallery
3. User clicks PDF
4. Modal opens
5. User navigates pages
6. User zooms in/out
7. User downloads PDF
8. User closes modal
```

## Documentation

For more information, see:

- `PDF_GALLERY_IMPLEMENTATION_GUIDE.md` - Implementation guide
- `PDF_IMPLEMENTATION_TEST_REPORT.md` - Test results
- `PDF_HANDLER_IMPLEMENTATION_SUMMARY.md` - Feature overview
- `DEPLOYMENT_CHECKLIST.md` - Deployment steps

## Version History

### v1.0.0 (July 18, 2026)
- Initial release
- PDFViewerModal component
- PDFGalleryItem component
- PDFCarousel component
- Full documentation

## Support

For issues or questions:

1. Check troubleshooting section above
2. Review test report
3. Inspect browser console
4. Contact development team

## License

Part of OnTap Portal project
