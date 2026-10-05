---
title: "Shortcode örnekleri"
date: 2026-09-20T12:00:00+03:00
---

Satır içi: {{< param "title" >}} ve [bağlantı]({{< relref "yazilar/ornek.md" >}}).

{{< figure src="/img/ornek.jpg" alt="Örnek görsel" caption="Merhaba dünya" >}}

{{% details summary="Ayrıntılar" %}}
Bu **markdown** içerik.
{{% /details %}}

{{< highlight go "linenos=table" >}}
fmt.Println("Merhaba dünya")
{{< /highlight >}}

Kaçışlı: {{</* figure src="x.jpg" */>}} ve {{%/* details */%}}.

Kendiliğinden kapanan: {{< ornek-kod baslik="Deneme" />}}

Bilinmeyen: {{< bilinmeyen a="b" >}}

Çok satırlı:

{{< figure
  src="/img/uzun.jpg"
  caption="İçinde >}} geçen tırnak"
>}}

```go-html-template
{{</* youtube id="abc" */>}}
```
