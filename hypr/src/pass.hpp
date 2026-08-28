#pragma once

#include "runtime.hpp"

#include <hyprland/src/render/pass/PassElement.hpp>
#include <hyprland/src/helpers/math/Math.hpp>

class CShinyPassElement : public IPassElement {
  public:
    struct SData {
        // Shared rounding / colors / logical thickness / alpha. Filled from
        // shinyMapDrawBackends().shader — not a parallel copy of those fields.
        // shared.borderSize is logical (unscaled) px. CShinyPassElement::draw
        // uploads shinyShaderThick(shared.borderSize, mon->m_scale, combinedScale()).
        // Rounding / outerRound are already monitor-scaled; draw multiplies
        // combinedScale() at upload. Do not store already-scaled borderSize.
        ShinyDrawShared shared;
        CBox            box;      // scaled, monitor-local, outer; includes m_floatingOffset
        float           angle   = 0.f; // drawn heading, radians: latched or pinned, plus shimmer
        float           time    = 0.f;
        float           pulseHz = 0.4f;
        float           lobe    = 0.18f; // effective half-width; shimmer scale already applied
        float           thickScale = 1.f; // shimmer thickness modulation; 1 when not shimmering
    };

    CShinyPassElement(const SData& data);
    virtual ~CShinyPassElement() = default;

    virtual std::vector<UP<IPassElement>> draw() override;
    virtual bool                          needsLiveBlur() override;
    virtual bool                          needsPrecomputeBlur() override;
    virtual std::optional<CBox>           boundingBox() override;
    virtual CRegion                       opaqueRegion() override;
    virtual bool                          disableSimplification() override;

    virtual const char*                   passName() override {
        return "CShinyPassElement";
    }

    virtual ePassElementType type() override {
        return EK_CUSTOM;
    }

    SData m_data;
};

bool ensureShinyShader();
void destroyShinyShader();
void markShinyTeardown();
void shinyResetLifecycle();
